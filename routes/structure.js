const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { generateSchoolBoards, generateSchoolClasses, generateSchoolStreams, generateSchoolSubjects, generateSchoolChapters, generateUniversities, generateSemesters, generatePapersStages, fetchAIStructure } = require('../services/aiService');

// Simple Memory Rate Limiter for public AI fetches
const rateLimitMap = new Map();
const rateLimitMiddleware = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 mins
    const maxRequests = 10;

    if (!rateLimitMap.has(ip)) {
        rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs });
        return next();
    }

    const record = rateLimitMap.get(ip);
    if (now > record.resetTime) {
        record.count = 1;
        record.resetTime = now + windowMs;
        return next();
    }

    record.count++;
    if (record.count > maxRequests) {
        return res.status(429).json({ success: false, message: 'Too many fetch requests from this IP. Please wait 15 minutes.' });
    }
    next();
};

const activeFetches = new Set(); // Concurrency guard

// Helper to return empty instead of 500 if no data
const safeFetch = async (q, params, res) => {
    try {
        const result = await query(q, params);
        res.json(result.rows);
    } catch (error) {
        console.error(`Structure Fetch Error: ${q}`, error.message);
        res.status(500).json({ message: 'Server error', data: [] });
    }
};

// @route   GET /api/structure
// @desc    Structure health check
// @access  Public
router.get('/', (req, res) => {
    res.json({ message: 'Structure service is running' });
});

// @route   GET /api/structure/categories
router.get('/categories', (req, res) => safeFetch('SELECT * FROM categories WHERE is_active = TRUE ORDER BY sort_order ASC', [], res));

// @route   GET /api/structure/states
router.get('/states', (req, res) => safeFetch('SELECT id, name FROM states ORDER BY name ASC', [], res));

// @route   GET /api/structure/languages
router.get('/languages', (req, res) => safeFetch('SELECT id, name FROM languages ORDER BY name ASC', [], res));

// @route   GET /api/structure/boards/:state_id
router.get('/boards/:state_id', (req, res) => safeFetch('SELECT id, name FROM boards WHERE state_id = $1 AND is_active = TRUE ORDER BY name ASC', [req.params.state_id], res));

// @route   GET /api/structure/classes
router.get('/classes', (req, res) => safeFetch('SELECT id, name FROM classes WHERE is_active = TRUE ORDER BY id ASC', [], res));

// @route   GET /api/structure/classes/:board_id
router.get('/classes/:board_id', (req, res) => {
    safeFetch(`
        SELECT c.id, c.name 
        FROM board_classes bc 
        JOIN classes c ON bc.class_id = c.id 
        WHERE bc.board_id = $1 AND bc.is_active = TRUE 
        ORDER BY c.id ASC
    `, [req.params.board_id], res);
});

// @route   GET /api/structure/streams
router.get('/streams', (req, res) => safeFetch('SELECT id, name FROM streams WHERE is_active = TRUE ORDER BY name ASC', [], res));

// @route   GET /api/structure/universities/:state_id
router.get('/universities/:state_id', (req, res) => safeFetch('SELECT id, name FROM universities WHERE state_id = $1 AND is_active = TRUE ORDER BY name ASC', [req.params.state_id], res));

// @route   GET /api/structure/degree-types
router.get('/degree-types', (req, res) => safeFetch('SELECT * FROM degree_types ORDER BY name ASC', [], res));

// @route   GET /api/structure/semesters/:university_id
router.get('/semesters', (req, res) => safeFetch('SELECT id, name FROM semesters ORDER BY id ASC', [], res));

// @route   GET /api/structure/papers-stages/:category_id
router.get('/papers-stages/:category_id', (req, res) => safeFetch('SELECT id, name FROM papers_stages WHERE category_id = $1 AND is_active = TRUE ORDER BY name ASC', [req.params.category_id], res));

// @route   GET /api/structure/subjects
router.get('/subjects', (req, res) => {
    const { category_id, board_id, class_id, stream_id, university_id, semester_id, paper_stage_id } = req.query;
    let q = 'SELECT id, name FROM subjects WHERE is_active = TRUE';
    const params = [];
    if (category_id) { params.push(category_id); q += ` AND category_id = $${params.length}`; }
    if (board_id) { params.push(board_id); q += ` AND board_id = $${params.length}`; }
    if (class_id) { params.push(class_id); q += ` AND class_id = $${params.length}`; }
    if (stream_id) { params.push(stream_id); q += ` AND stream_id = $${params.length}`; }
    if (university_id) { params.push(university_id); q += ` AND university_id = $${params.length}`; }
    if (semester_id) { params.push(semester_id); q += ` AND semester_id = $${params.length}`; }
    if (paper_stage_id) { params.push(paper_stage_id); q += ` AND paper_stage_id = $${params.length}`; }
    q += ' ORDER BY name ASC';
    safeFetch(q, params, res);
});

// @route   GET /api/structure/subjects/:class_id (Direct path)
router.get('/subjects/:class_id', (req, res) => safeFetch('SELECT id, name FROM subjects WHERE class_id = $1 AND is_active = TRUE ORDER BY name ASC', [req.params.class_id], res));

// @route   GET /api/structure/chapters/:subject_id
router.get('/chapters/:subject_id', (req, res) => safeFetch('SELECT id, name FROM chapters WHERE subject_id = $1 AND is_active = TRUE ORDER BY name ASC', [req.params.subject_id], res));

// @route   POST /api/structure/fetch-out-boards
// @desc    User-triggered AI fetch for boards
router.post('/fetch-out-boards', rateLimitMiddleware, async (req, res) => {
    const { state_id, state_name } = req.body;
    if (!state_id || !state_name) return res.status(400).json({ error: 'Missing state info' });

    const key = `boards_${state_id}`;
    if (activeFetches.has(key)) return res.status(429).json({ message: 'Fetch already in progress. Please wait.' });
    activeFetches.add(key);

    try {
        const boards = await generateSchoolBoards(state_name);
        const saved = [];
        for (const item of boards) {
            const name = (item.name || '').substring(0, 200).trim();
            if (!name) continue;
            // Filter non-school
            const nonSchoolKeywords = ['university', 'joint entrance', 'entrance examination', 'jee', 'neet', 'council of higher', 'technical education', 'medical', 'engineering', 'college', 'polytechnic', 'distance education', 'open university', 'deemed', 'affiliated'];
            const isNonSchoolBoard = nonSchoolKeywords.some(kw => name.toLowerCase().includes(kw));
            if (isNonSchoolBoard) continue;

            const result = await query(
                'INSERT INTO boards (name, state_id, is_active) VALUES ($1, $2, TRUE) ON CONFLICT (state_id, name) DO UPDATE SET is_active = TRUE RETURNING id, name',
                [name, state_id]
            );
            if (result.rows[0]) saved.push(result.rows[0]);
        }
        res.json({ success: true, count: saved.length, data: saved });
    } catch (err) {
        console.error('Fetch Out Boards Error:', err);
        res.status(500).json({ error: 'Failed to fetch boards' });
    } finally {
        activeFetches.delete(key);
    }
});

// @route   POST /api/structure/fetch-out-subjects
router.post('/fetch-out-subjects', rateLimitMiddleware, async (req, res) => {
    const { board_id, board_name, class_id, class_name, stream_id, stream_name, university_id, university_name, semester_id, semester_name, paper_stage_id, paper_stage_name, category_id, category_name } = req.body;

    let flowType = '';
    let context_name = '';
    let cacheKey = '';
    let finalCategoryId = category_id || 1;

    if (board_id && class_id) {
        flowType = 'school';
        context_name = `Board: ${board_name}, Class: ${class_name}` + (stream_name ? `, Stream: ${stream_name}` : '');
        cacheKey = `subjects_school_${board_id}_${class_id}_${stream_id || 'all'}`;
        finalCategoryId = category_id || 1;
    } else if (university_id && semester_id) {
        flowType = 'university';
        context_name = `University: ${university_name}, Semester/Year: ${semester_name}`;
        cacheKey = `subjects_uni_${university_id}_${semester_id}`;
        finalCategoryId = category_id || 2;
    } else if (paper_stage_id && category_id) {
        flowType = 'competitive';
        context_name = `Exam Category: ${category_name}, Stage: ${paper_stage_name}`;
        cacheKey = `subjects_comp_${paper_stage_id}`;
        finalCategoryId = category_id;
    } else {
        return res.status(400).json({ error: 'Missing required contextual info' });
    }

    if (activeFetches.has(cacheKey)) return res.status(429).json({ message: 'Fetch already in progress. Please wait.' });
    activeFetches.add(cacheKey);

    try {
        let subjects;
        if (flowType === 'school') {
            subjects = await generateSchoolSubjects(board_name, class_name, stream_name);
        } else {
            subjects = await fetchAIStructure('Subjects', `Context: ${context_name}. Strictly original syllabus subject names only. No placeholders.`, 30);
        }

        const saved = [];
        for (const item of subjects) {
            const name = (item.name || '').substring(0, 200).trim();
            if (!name) continue;

            const existing = await query(
                `SELECT id FROM subjects 
                 WHERE (board_id = $1 OR (board_id IS NULL AND $1 IS NULL))
                 AND (class_id = $2 OR (class_id IS NULL AND $2 IS NULL))
                 AND (stream_id = $3 OR (stream_id IS NULL AND $3 IS NULL)) 
                 AND (university_id = $4 OR (university_id IS NULL AND $4 IS NULL))
                 AND (semester_id = $5 OR (semester_id IS NULL AND $5 IS NULL))
                 AND (paper_stage_id = $6 OR (paper_stage_id IS NULL AND $6 IS NULL))
                 AND LOWER(name) = LOWER($7)`,
                [board_id || null, class_id || null, stream_id || null, university_id || null, semester_id || null, paper_stage_id || null, name]
            );

            if (existing.rows.length > 0) {
                await query('UPDATE subjects SET is_active = TRUE WHERE id = $1', [existing.rows[0].id]);
                saved.push({ id: existing.rows[0].id, name });
            } else {
                const result = await query(
                    `INSERT INTO subjects (name, category_id, board_id, class_id, stream_id, university_id, semester_id, paper_stage_id, is_active, is_approved) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, TRUE) RETURNING id, name`,
                    [name, finalCategoryId, board_id || null, class_id || null, stream_id || null, university_id || null, semester_id || null, paper_stage_id || null]
                );
                if (result.rows[0]) saved.push(result.rows[0]);
            }
        }
        res.json({ success: true, count: saved.length, data: saved });
    } catch (err) {
        console.error('Fetch Out Subjects Error:', err);
        res.status(500).json({ error: 'Failed to fetch subjects' });
    } finally {
        activeFetches.delete(cacheKey);
    }
});

// @route   POST /api/structure/fetch-out-chapters
router.post('/fetch-out-chapters', rateLimitMiddleware, async (req, res) => {
    const { subject_id, subject_name, board_name, class_name, university_name, semester_name, paper_stage_name, category_name } = req.body;
    if (!subject_id || !subject_name) return res.status(400).json({ error: 'Missing subject info' });

    let context_name = '';
    if (board_name && class_name) context_name = `Board: ${board_name}, Class: ${class_name}`;
    else if (university_name && semester_name) context_name = `University: ${university_name}, Semester: ${semester_name}`;
    else if (paper_stage_name) context_name = `Exam: ${category_name}, Stage: ${paper_stage_name}`;

    const key = `chapters_${subject_id}`;
    if (activeFetches.has(key)) return res.status(429).json({ message: 'Fetch already in progress. Please wait.' });
    activeFetches.add(key);

    try {
        let chapters;
        if (board_name && class_name) {
            chapters = await generateSchoolChapters(subject_name, board_name, class_name);
        } else {
            chapters = await fetchAIStructure('Chapters', `Subject: ${subject_name}, Context: ${context_name}. Strictly original syllabus chapter names only.`, 30);
        }

        const saved = [];
        for (const item of chapters) {
            const name = (item.name || '').substring(0, 200).trim();
            if (!name) continue;

            const existing = await query(
                `SELECT id FROM chapters WHERE subject_id = $1 AND LOWER(name) = LOWER($2)`,
                [subject_id, name]
            );
            if (existing.rows.length > 0) {
                await query('UPDATE chapters SET is_active = TRUE WHERE id = $1', [existing.rows[0].id]);
                saved.push({ id: existing.rows[0].id, name });
            } else {
                const result = await query(
                    `INSERT INTO chapters (name, subject_id, is_active) VALUES ($1, $2, TRUE) ON CONFLICT (subject_id, name) DO UPDATE SET is_active = TRUE RETURNING id, name`,
                    [name, subject_id]
                );
                if (result.rows[0]) saved.push(result.rows[0]);
            }
        }
        res.json({ success: true, count: saved.length, data: saved });
    } catch (err) {
        console.error('Fetch Out Chapters Error:', err);
        res.status(500).json({ error: 'Failed to fetch chapters' });
    } finally {
        activeFetches.delete(key);
    }
});

// @route   POST /api/structure/fetch-out-classes
router.post('/fetch-out-classes', rateLimitMiddleware, async (req, res) => {
    const { board_id, board_name } = req.body;
    if (!board_id || !board_name) return res.status(400).json({ error: 'Missing required info' });

    const key = `classes_${board_id}`;
    if (activeFetches.has(key)) return res.status(429).json({ message: 'Fetch already in progress. Please wait.' });
    activeFetches.add(key);

    try {
        const generatedClasses = await generateSchoolClasses(board_name);
        const saved = [];

        for (const item of generatedClasses) {
            const name = (item.name || '').substring(0, 50).trim();
            if (!name) continue;

            // 1. Find or create the class globally
            const classRes = await query(
                `INSERT INTO classes (name, class_id, is_active) VALUES ($1, $1, TRUE) 
                 ON CONFLICT (name) DO UPDATE SET is_active = TRUE RETURNING id, name`,
                [name]
            );
            const class_ref_id = classRes.rows[0].id;

            // 2. Map the class to this specific board
            await query(
                `INSERT INTO board_classes (board_id, class_id, is_active) VALUES ($1, $2, TRUE)
                 ON CONFLICT (board_id, class_id) DO UPDATE SET is_active = TRUE`,
                [board_id, class_ref_id]
            );

            saved.push({ id: class_ref_id, name });
        }
        res.json({ success: true, count: saved.length, data: saved });
    } catch (err) {
        console.error('Fetch Out Classes Error:', err);
        res.status(500).json({ error: 'Failed to fetch classes' });
    } finally {
        activeFetches.delete(key);
    }
});

// @route   POST /api/structure/fetch-out-streams
router.post('/fetch-out-streams', rateLimitMiddleware, async (req, res) => {
    const { board_name, class_name } = req.body;
    if (!board_name || !class_name) return res.status(400).json({ error: 'Missing required info' });

    const key = `streams_${board_name}_${class_name}`;
    if (activeFetches.has(key)) return res.status(429).json({ message: 'Fetch already in progress. Please wait.' });
    activeFetches.add(key);

    try {
        const streams = await generateSchoolStreams(board_name, class_name);
        const saved = [];

        for (const item of streams) {
            const name = (item.name || '').substring(0, 100).trim();
            if (!name) continue;

            const existing = await query(`SELECT id FROM streams WHERE LOWER(name) = LOWER($1)`, [name]);
            if (existing.rows.length > 0) {
                await query('UPDATE streams SET is_active = TRUE WHERE id = $1', [existing.rows[0].id]);
                saved.push({ id: existing.rows[0].id, name });
            } else {
                const result = await query(
                    `INSERT INTO streams (name, is_active) VALUES ($1, TRUE) ON CONFLICT (name) DO UPDATE SET is_active = TRUE RETURNING id, name`,
                    [name]
                );
                if (result.rows[0]) saved.push(result.rows[0]);
            }
        }
        res.json({ success: true, count: saved.length, data: saved });
    } catch (err) {
        console.error('Fetch Out Streams Error:', err);
        res.status(500).json({ error: 'Failed to fetch streams' });
    } finally {
        activeFetches.delete(key);
    }
});

module.exports = router;

// @route   POST /api/structure/fetch-out-universities
router.post('/fetch-out-universities', rateLimitMiddleware, async (req, res) => {
    const { state_id, state_name } = req.body;
    if (!state_id || !state_name) return res.status(400).json({ error: 'Missing state info' });

    const key = `universities_${state_id}`;
    if (activeFetches.has(key)) return res.status(429).json({ message: 'Fetch already in progress. Please wait.' });
    activeFetches.add(key);

    try {
        const universities = await generateUniversities(state_name);
        const saved = [];
        for (const item of universities) {
            const name = (item.name || '').substring(0, 200).trim();
            if (!name || name.toLowerCase().includes('placeholder') || name.startsWith('DEBUG_ERROR')) continue;

            const result = await query(
                'INSERT INTO universities (name, state_id, is_active) VALUES ($1, $2, TRUE) ON CONFLICT (state_id, name) DO UPDATE SET is_active = TRUE RETURNING id, name',
                [name, state_id]
            );
            if (result.rows[0]) saved.push(result.rows[0]);
        }
        res.json({ success: true, count: saved.length, data: saved });
    } catch (err) {
        console.error('Fetch Out Universities Error:', err);
        res.status(500).json({ error: 'Failed to fetch universities' });
    } finally {
        activeFetches.delete(key);
    }
});

// @route   POST /api/structure/fetch-out-semesters
router.post('/fetch-out-semesters', rateLimitMiddleware, async (req, res) => {
    const { university_id, university_name } = req.body;
    if (!university_id || !university_name) return res.status(400).json({ error: 'Missing university info' });

    const key = `semesters_${university_id}`;
    if (activeFetches.has(key)) return res.status(429).json({ message: 'Fetch already in progress. Please wait.' });
    activeFetches.add(key);

    try {
        const semesters = await generateSemesters(university_name);
        const saved = [];
        for (const item of semesters) {
            const name = (item.name || '').substring(0, 100).trim();
            if (!name) continue;

            const existing = await query(`SELECT id FROM semesters WHERE university_id = $1 AND LOWER(name) = LOWER($2)`, [university_id, name]);
            if (existing.rows.length > 0) {
                saved.push({ id: existing.rows[0].id, name });
            } else {
                const result = await query(
                    'INSERT INTO semesters (name, university_id) VALUES ($1, $2) ON CONFLICT (university_id, name) DO NOTHING RETURNING id, name',
                    [name, university_id]
                );
                if (result.rows[0]) {
                    saved.push(result.rows[0]);
                } else {
                    const existing2 = await query(`SELECT id, name FROM semesters WHERE university_id = $1 AND LOWER(name) = LOWER($2)`, [university_id, name]);
                    if (existing2.rows[0]) saved.push(existing2.rows[0]);
                }
            }
        }
        res.json({ success: true, count: saved.length, data: saved });
    } catch (err) {
        console.error('Fetch Out Semesters Error:', err);
        res.status(500).json({ error: 'Failed to fetch semesters' });
    } finally {
        activeFetches.delete(key);
    }
});

// @route   POST /api/structure/fetch-out-papers-stages
router.post('/fetch-out-papers-stages', rateLimitMiddleware, async (req, res) => {
    const { category_id, category_name } = req.body;
    if (!category_id || !category_name) return res.status(400).json({ error: 'Missing category info' });

    const key = `papers_${category_id}`;
    if (activeFetches.has(key)) return res.status(429).json({ message: 'Fetch already in progress. Please wait.' });
    activeFetches.add(key);

    try {
        const papers = await generatePapersStages(category_name);
        const saved = [];
        for (const item of papers) {
            const name = (item.name || '').substring(0, 200).trim();
            if (!name) continue;

            const existing = await query(`SELECT id FROM papers_stages WHERE category_id = $1 AND LOWER(name) = LOWER($2)`, [category_id, name]);
            if (existing.rows.length > 0) {
                await query('UPDATE papers_stages SET is_active = TRUE WHERE id = $1', [existing.rows[0].id]);
                saved.push({ id: existing.rows[0].id, name });
            } else {
                const result = await query(
                    'INSERT INTO papers_stages (name, category_id, is_active) VALUES ($1, $2, TRUE) ON CONFLICT (category_id, name) DO UPDATE SET is_active = TRUE RETURNING id, name',
                    [name, category_id]
                );
                if (result.rows[0]) saved.push(result.rows[0]);
            }
        }
        res.json({ success: true, count: saved.length, data: saved });
    } catch (err) {
        console.error('Fetch Out Papers Stages Error:', err);
        res.status(500).json({ error: 'Failed to fetch papers stages' });
    } finally {
        activeFetches.delete(key);
    }
});
