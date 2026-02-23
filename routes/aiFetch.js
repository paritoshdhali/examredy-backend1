const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { verifyToken, admin } = require('../middleware/authMiddleware');

// @route   GET /api/ai-fetch
// @desc    AI Fetch service health check
// @access  Public
router.get('/', (req, res) => {
    res.json({ message: 'AI Fetch service is running' });
});

// @route   GET /api/ai-fetch/providers
// @desc    Get active AI providers (Admin)
// @access  Admin
router.get('/providers', verifyToken, admin, async (req, res) => {
    try {
        const result = await query('SELECT id, name, model_name, is_active FROM ai_providers WHERE is_active = TRUE');
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/ai-fetch/logs
// @desc    Get fetch logs (Admin)
// @access  Admin
router.get('/logs', verifyToken, admin, async (req, res) => {
    try {
        const result = await query('SELECT * FROM ai_fetch_logs ORDER BY created_at DESC LIMIT 50');
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/ai-fetch/diag
// @desc    AI Provider Diagnostic (Admin)
router.get('/diag', verifyToken, admin, async (req, res) => {
    try {
        const result = await query('SELECT name, model_name, is_active, (api_key IS NOT NULL AND api_key != \'\') as has_key FROM ai_providers');
        res.json({
            providers: result.rows,
            env_ai_key_set: !!process.env.AI_API_KEY,
            env_gemini_key_set: !!process.env.GEMINI_API_KEY
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

const { generateMCQInitial, fetchAIStructure } = require('../services/aiService');

// @route   POST /api/ai-fetch/boards
router.post('/boards', verifyToken, admin, async (req, res) => {
    const { state_id, state_name } = req.body;
    try {
        // Strictly fetch school education boards only (Class 1-12 level)
        const boards = await fetchAIStructure(
            'School Education Boards',
            `State of ${state_name}, India. List ONLY boards that govern school education (Class 1 to Class 12), such as state secondary boards, CBSE, ICSE/CISCE, NIOS. DO NOT include university boards, entrance exam boards (JEE/NEET/WBJEE), council of higher education, technical boards, or any board not related to school-level (Class 1-12) education.`
        );
        const saved = [];
        let existingCount = 0;

        // Words that indicate NON-school boards — filter them out
        const nonSchoolKeywords = [
            'university', 'joint entrance', 'entrance examination', 'jee', 'neet', 'council of higher',
            'technical education', 'medical', 'engineering', 'college', 'polytechnic',
            'distance education', 'open university', 'deemed', 'affiliated'
        ];
        const isNonSchoolBoard = (name) =>
            nonSchoolKeywords.some(kw => name.toLowerCase().includes(kw));

        await query('BEGIN');
        try {
            for (const item of boards) {
                const name = (item.name || '').substring(0, 200);
                // Smarter placeholder / error guard
                const isPlaceholder = /^(board|subject|chapter|class)\s+([0-9a-z])$/i.test(name.trim());
                if (isPlaceholder || name.toLowerCase().includes('placeholder') || name.startsWith('DEBUG_ERROR')) continue;
                // Skip non-school boards (university/entrance/council etc.)
                if (isNonSchoolBoard(name)) { console.log(`[Boards Filter] Skipped non-school board: ${name}`); continue; }

                const result = await query(
                    'INSERT INTO boards (name, state_id, is_active) VALUES ($1, $2, $3) ON CONFLICT (state_id, name) DO NOTHING RETURNING *',
                    [name, state_id, false]
                );
                if (result.rows[0]) {
                    saved.push(result.rows[0]);
                } else {
                    existingCount++;
                }
            }
            await query('COMMIT');
        } catch (err) {
            await query('ROLLBACK');
            throw err;
        }

        let message = `${saved.length} Boards fetched and saved.`;
        if (existingCount > 0) message += ` ${existingCount} already existed.`;
        // Fetch updated full boards list
        const updated = await query('SELECT b.*, s.name as state_name FROM boards b LEFT JOIN states s ON b.state_id = s.id ORDER BY b.name ASC');
        if (saved.length === 0 && existingCount === 0) {
            return res.status(422).json({ success: false, message: 'AI returned no valid boards. Check Neural Hub AI provider settings.' });
        }
        res.json({ success: true, count: saved.length, message, updatedData: updated.rows });
    } catch (error) {
        console.error('AI Fetch Boards Error:', error);
        res.status(500).json({ message: error.message || 'Server error during board fetch' });
    }
});

// @route   POST /api/ai-fetch/classes
router.post('/classes', verifyToken, admin, async (req, res) => {
    const { board_id, board_name } = req.body;
    try {
        const allClasses = await query('SELECT id, name FROM classes ORDER BY id ASC');
        let classesToOffer = allClasses.rows;

        const n = (board_name || '').toLowerCase();
        if (n.includes('higher secondary') || n.includes('intermediate') || n.includes('pre-university') || n.includes('+2') || n.includes('hsc') || n.includes('council of higher')) {
            classesToOffer = classesToOffer.filter(c => parseInt(c.name.replace(/\D/g, '')) >= 11);
        } else if (n.includes('primary') || n.includes('elementary')) {
            classesToOffer = classesToOffer.filter(c => parseInt(c.name.replace(/\D/g, '')) <= 5);
        } else if ((n.includes('secondary') && !n.includes('higher')) || n.includes('madhyamik') || n.includes('matriculation') || n.includes('sslc')) {
            classesToOffer = classesToOffer.filter(c => parseInt(c.name.replace(/\D/g, '')) <= 10);
        }

        const saved = [];
        let existingCount = 0;

        await query('BEGIN');
        try {
            for (const c of classesToOffer) {
                const result = await query(
                    'INSERT INTO board_classes (board_id, class_id, is_active) VALUES ($1, $2, FALSE) ON CONFLICT (board_id, class_id) DO NOTHING RETURNING *',
                    [board_id, c.id]
                );
                if (result.rows[0]) saved.push(result.rows[0]);
                else existingCount++;
            }
            await query('COMMIT');
        } catch (err) {
            await query('ROLLBACK');
            throw err;
        }

        let message = `${saved.length} Classes fetched.`;
        if (existingCount > 0) message += ` ${existingCount} already existed.`;

        const updated = await query(`
            SELECT bc.id, c.id as class_id, c.name, bc.is_active 
            FROM board_classes bc 
            JOIN classes c ON bc.class_id = c.id 
            WHERE bc.board_id = $1 ORDER BY c.id ASC
        `, [board_id]);

        res.json({ success: true, count: saved.length, message, updatedData: updated.rows });
    } catch (error) {
        console.error('AI Fetch Classes Error:', error);
        res.status(500).json({ message: error.message || 'Server error' });
    }
});

// @route   POST /api/ai-fetch/universities
router.post('/universities', verifyToken, admin, async (req, res) => {
    const { state_id, state_name } = req.body;
    try {
        const universities = await fetchAIStructure('Universities', `State of ${state_name}, India.Strictly provide original names only.`);
        const saved = [];
        let existingCount = 0;

        await query('BEGIN');
        try {
            for (const item of universities) {
                const name = (item.name || '').substring(0, 200);
                if (name.toLowerCase().includes('university ') || name.toLowerCase().includes('placeholder') || name.startsWith('DEBUG_ERROR')) continue;
                const result = await query('INSERT INTO universities (name, state_id, is_active) VALUES ($1, $2, $3) ON CONFLICT (state_id, name) DO NOTHING RETURNING *', [name, state_id, false]);
                if (result.rows[0]) {
                    saved.push(result.rows[0]);
                } else {
                    existingCount++;
                }
            }
            await query('COMMIT');
        } catch (err) {
            await query('ROLLBACK');
            throw err;
        }
        let message = `${saved.length} Universities fetched and saved.`;
        if (existingCount > 0) message += ` ${existingCount} already existed.`;
        const updUni = await query('SELECT u.*, s.name as state_name FROM universities u LEFT JOIN states s ON u.state_id = s.id ORDER BY u.name ASC');
        if (saved.length === 0 && existingCount === 0) {
            return res.status(422).json({ success: false, message: 'AI returned no valid universities. Check Neural Hub AI provider settings.' });
        }
        res.json({ success: true, count: saved.length, message, updatedData: updUni.rows });
    } catch (error) {
        console.error('AI Fetch Universities Error:', error);
        res.status(500).json({ message: error.message || 'Server error during university fetch' });
    }
});

// @route   POST /api/ai-fetch/papers
router.post('/papers', verifyToken, admin, async (req, res) => {
    const { category_id, category_name } = req.body;
    try {
        const papers = await fetchAIStructure('Papers/Stages', `Exam Category: ${category_name}. Strictly original names.`);
        const saved = [];
        let existingCount = 0;
        await query('BEGIN');
        try {
            for (const item of papers) {
                const name = (item.name || '').substring(0, 200);
                const result = await query('INSERT INTO papers_stages (name, category_id, is_active) VALUES ($1, $2, $3) ON CONFLICT (category_id, name) DO NOTHING RETURNING *', [name, category_id, false]);
                if (result.rows[0]) {
                    saved.push(result.rows[0]);
                } else {
                    existingCount++;
                }
            }
            await query('COMMIT');
        } catch (err) {
            await query('ROLLBACK');
            throw err;
        }
        let message = `${saved.length} Papers / Stages fetched and saved.`;
        if (existingCount > 0) message += ` ${existingCount} already existed.`;
        const updPap = await query('SELECT p.*, c.name as category_name FROM papers_stages p LEFT JOIN categories c ON p.category_id = c.id ORDER BY p.name ASC');
        if (saved.length === 0 && existingCount === 0) {
            return res.status(422).json({ success: false, message: 'AI returned no valid papers. Check Neural Hub AI provider settings.' });
        }
        res.json({ success: true, count: saved.length, message, updatedData: updPap.rows });
    } catch (error) {
        console.error('AI Fetch Papers Error:', error);
        res.status(500).json({ message: error.message || 'Server error during papers fetch' });
    }
});

// @route   POST /api/ai-fetch/streams
// Returns the streams relevant for given board + class (checks DB for existing, adds if needed)
router.post('/streams', verifyToken, admin, async (req, res) => {
    const { board_name, class_name } = req.body;
    try {
        // Ask AI which streams are relevant for this board+class
        const aiStreams = await fetchAIStructure(
            'Streams',
            `Board: "${board_name}", ${class_name} (India).List ONLY the academic streams / branches offered at this class level by this board.Typical values: Science, Commerce, Arts / Humanities, Vocational.Return only what this board actually offers.`
        );

        // Upsert streams into DB (or match existing)
        const resultStreams = [];
        for (const item of aiStreams) {
            const name = (item.name || '').trim().substring(0, 100);
            if (!name) continue;
            // Insert if not exists, then return the row
            const r = await query(
                `INSERT INTO streams(name) VALUES($1) ON CONFLICT(name) DO NOTHING; `,
                [name]
            );
            const existing = await query(`SELECT * FROM streams WHERE LOWER(name) = LOWER($1) LIMIT 1`, [name]);
            if (existing.rows[0]) resultStreams.push(existing.rows[0]);
        }

        // If AI returned nothing, fall back to all existing streams
        const allStreams = resultStreams.length > 0 ? resultStreams
            : (await query('SELECT * FROM streams ORDER BY name ASC')).rows;

        res.json({
            success: true,
            streams: allStreams,
            message: `${resultStreams.length > 0 ? resultStreams.length + ' streams' : 'Default streams'} loaded for ${board_name}`
        });
    } catch (error) {
        console.error('AI Fetch Streams Error:', error);
        // Fallback: return all DB streams
        try {
            const fallback = await query('SELECT * FROM streams ORDER BY name ASC');
            res.json({ success: true, streams: fallback.rows, message: 'Default streams loaded (AI unavailable)' });
        } catch (e2) {
            res.status(500).json({ message: error.message || 'Server error during stream fetch' });
        }
    }
});

// @route   POST /api/ai-fetch/semesters
// Returns the semesters or years relevant for a given University + Degree Type
router.post('/semesters', verifyToken, admin, async (req, res) => {
    const { university_id, university_name, degree_type_name } = req.body;
    try {
        const aiItems = await fetchAIStructure(
            'Terms',
            `University: "${university_name}", Degree: "${degree_type_name}"(India).List the academic terms used(e.g., "Semester 1", "Semester 2", or "1st Year", "2nd Year").Return only the names of the terms.`
        );

        const resultSemesters = [];
        for (const item of aiItems) {
            const name = (item.name || '').trim().substring(0, 100);
            if (!name) continue;

            // Insert into semesters table
            const r = await query(
                `INSERT INTO semesters(name, university_id)
        VALUES($1, $2) 
                 ON CONFLICT(university_id, name) DO NOTHING RETURNING *; `,
                [name, university_id]
            );

            if (r.rows[0]) {
                resultSemesters.push(r.rows[0]);
            } else {
                const existing = await query(
                    `SELECT * FROM semesters WHERE university_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
                    [university_id, name]
                );
                if (existing.rows[0]) resultSemesters.push(existing.rows[0]);
            }
        }

        res.json({
            success: true,
            semesters: resultSemesters,
            message: `${resultSemesters.length} terms loaded for ${university_name}`
        });
    } catch (error) {
        console.error('AI Fetch Semesters Error:', error);
        res.status(500).json({ message: error.message || 'Server error during semester fetch' });
    }
});

// @route   POST /api/ai-fetch/subjects
router.post('/subjects', verifyToken, admin, async (req, res) => {
    const { category_id, board_id, university_id, class_id, stream_id, semester_id, degree_type_id, paper_stage_id, context_name } = req.body;
    try {
        const subjects = await fetchAIStructure('Subjects', `Context: ${context_name}. Strictly original syllabus subject names only.No placeholders.`);
        const saved = [];
        let existingCount = 0;

        await query('BEGIN');
        try {
            for (const item of subjects) {
                const name = (item.name || '').substring(0, 200);
                const isPlaceholder = /^(board|subject|chapter|class)\s+([0-9a-z])$/i.test(name.trim());
                if (isPlaceholder || name.toLowerCase().includes('placeholder') || name.startsWith('DEBUG_ERROR')) continue;

                // Check if subject already exists
                const existing = await query(
                    `SELECT id FROM subjects 
                     WHERE board_id = $1 AND class_id = $2
        AND(stream_id = $3 OR(stream_id IS NULL AND $3 IS NULL)) 
                     AND LOWER(name) = LOWER($4)`,
                    [board_id, class_id, stream_id, name]
                );

                if (existing.rows.length > 0) {
                    existingCount++;
                    continue;
                }

                // Insert new subject
                const result = await query(
                    `INSERT INTO subjects(
            name, category_id, board_id, university_id, class_id, stream_id,
            semester_id, degree_type_id, paper_stage_id, is_active
        ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE) RETURNING * `,
                    [name, category_id, board_id, university_id, class_id, stream_id, semester_id, degree_type_id, paper_stage_id]
                );
                if (result.rows[0]) {
                    saved.push(result.rows[0]);
                }
            }
            await query('COMMIT');
        } catch (err) {
            await query('ROLLBACK');
            throw err;
        }
        let message = `${saved.length} Subjects fetched and saved.`;
        if (existingCount > 0) message += ` ${existingCount} already existed.`;
        const updSub = await query(`SELECT sub.*, b.name as board_name, c.name as class_name, str.name as stream_name, cat.name as category_name FROM subjects sub LEFT JOIN boards b ON sub.board_id = b.id LEFT JOIN classes c ON sub.class_id = c.id LEFT JOIN streams str ON sub.stream_id = str.id LEFT JOIN categories cat ON sub.category_id = cat.id ORDER BY sub.name ASC`);
        if (saved.length === 0 && existingCount === 0) {
            return res.status(422).json({ success: false, message: 'AI returned no valid subjects. Check Neural Hub AI provider settings.' });
        }
        res.json({ success: true, count: saved.length, message, updatedData: updSub.rows });
    } catch (error) {
        console.error('AI Fetch Subjects Error:', error);
        res.status(500).json({ message: error.message || 'Server error during subject fetch' });
    }
});

// @route   POST /api/ai-fetch/chapters
router.post('/chapters', verifyToken, admin, async (req, res) => {
    const { subject_id, subject_name } = req.body;
    try {
        const chapters = await fetchAIStructure('Chapters', `Subject: ${subject_name}. Strictly original syllabus chapter names only.`);
        const saved = [];
        let existingCount = 0;

        await query('BEGIN');
        try {
            for (const item of chapters) {
                const name = (item.name || '').substring(0, 200);
                const isPlaceholder = /^(board|subject|chapter|class)\s+([0-9a-z])$/i.test(name.trim());
                if (isPlaceholder || name.toLowerCase().includes('placeholder') || name.startsWith('DEBUG_ERROR')) continue;

                const result = await query(
                    'INSERT INTO chapters (name, subject_id, is_active) VALUES ($1, $2, FALSE) ON CONFLICT (subject_id, name) DO NOTHING RETURNING *',
                    [name, subject_id]
                );
                if (result.rows[0]) {
                    saved.push(result.rows[0]);
                } else {
                    existingCount++;
                }
            }
            await query('COMMIT');
        } catch (err) {
            await query('ROLLBACK');
            throw err;
        }

        let message = `${saved.length} Chapters fetched and saved.`;
        if (existingCount > 0) message += ` ${existingCount} already existed.`;
        const updCh = await query('SELECT ch.*, sub.name as subject_name FROM chapters ch LEFT JOIN subjects sub ON ch.subject_id = sub.id ORDER BY ch.name ASC');
        if (saved.length === 0 && existingCount === 0) {
            return res.status(422).json({ success: false, message: 'AI returned no valid chapters. Check Neural Hub AI provider settings.' });
        }
        res.json({ success: true, count: saved.length, message, updatedData: updCh.rows });
    } catch (error) {
        console.error('AI Fetch Chapters Error:', error);
        res.status(500).json({ message: error.message || 'Server error during chapter fetch' });
    }
});

module.exports = router;
