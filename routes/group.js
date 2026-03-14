const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { verifyToken } = require('../middleware/authMiddleware');
const crypto = require('crypto');
const { generateMCQInitial } = require('../services/aiService');

// @route   GET /api/group
// @desc    Group service health check
// @access  Public
router.get('/', (req, res) => {
    res.json({ message: 'Group service is running' });
});

// @route   POST /api/group/create
// @desc    Create a new group session
// @access  Private
router.post('/create', verifyToken, async (req, res) => {
    try {
        // Generate unique 6-char code
        const code = crypto.randomBytes(3).toString('hex').toUpperCase();

        const result = await query(
            'INSERT INTO group_sessions (id, creator_id) VALUES ($1, $2) RETURNING *',
            [code, req.user.id]
        );

        // Add creator as participant
        await query(
            'INSERT INTO group_participants (session_id, user_id) VALUES ($1, $2)',
            [code, req.user.id]
        );

        res.json({ session: result.rows[0], code, isHost: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/group/:code/status
// @desc    Get session status and participants
// @access  Private
router.get('/:code/status', verifyToken, async (req, res) => {
    const { code } = req.params;
    try {
        const sessionRes = await query(`
            SELECT gs.*, u.username as creator_name 
            FROM group_sessions gs
            JOIN users u ON gs.creator_id = u.id
            WHERE gs.id = $1 AND gs.is_active = TRUE
        `, [code]);

        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'Session not found' });
        }

        const session = sessionRes.rows[0];

        const participantsRes = await query(`
            SELECT u.username, u.id as user_id, gp.score
            FROM group_participants gp
            JOIN users u ON gp.user_id = u.id
            WHERE gp.session_id = $1
            ORDER BY gp.joined_at ASC
        `, [code]);

        let questions = [];
        if (session.status === 'active') {
            if (session.mcq_data) {
                // New logic: Use raw JSON data
                questions = typeof session.mcq_data === 'string' ? JSON.parse(session.mcq_data) : session.mcq_data;
            } else if (session.mcq_ids) {
                // Backward compatibility: Fetch from DB
                const ids = typeof session.mcq_ids === 'string' ? JSON.parse(session.mcq_ids) : session.mcq_ids;
                const mcqRes = await query(`
                    SELECT id, question, options, correct_option, explanation 
                    FROM mcq_pool 
                    WHERE id = ANY($1)
                `, [ids]);
                // Sort to match mcq_ids order
                questions = ids.map(id => mcqRes.rows.find(r => r.id === id)).filter(Boolean);
            }
        }

        res.json({
            status: session.status,
            categoryId: session.category_id,
            isHost: session.creator_id === req.user.id,
            questions,
            participants: participantsRes.rows.map(p => ({
                username: p.username,
                userId: p.user_id,
                score: p.score,
                isHost: p.user_id === session.creator_id
            }))
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/group/join
// @desc    Join an existing group session
// @access  Private
router.post('/join', verifyToken, async (req, res) => {
    const { code } = req.body;
    try {
        // Check session exists and is active
        const session = await query('SELECT * FROM group_sessions WHERE id = $1 AND is_active = TRUE', [code]);
        if (session.rows.length === 0) {
            return res.status(404).json({ message: 'Session not found or inactive' });
        }

        if (session.rows[0].status !== 'lobby') {
            return res.status(400).json({ message: 'Session already started or finished' });
        }

        // Check group size limit
        const participants = await query('SELECT count(*) FROM group_participants WHERE session_id = $1', [code]);
        const count = parseInt(participants.rows[0].count);

        const settings = await query('SELECT value FROM system_settings WHERE key = \'GROUP_SIZE_LIMIT\'');
        const limit = parseInt(settings.rows[0].value || '10');

        if (count >= limit) {
            return res.status(400).json({ message: 'Group full' });
        }

        // Add participant
        await query(
            'INSERT INTO group_participants (session_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [code, req.user.id]
        );

        res.json({ message: 'Joined session', code, isHost: session.rows[0].creator_id === req.user.id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/group/start
// @desc    Start the battle (Host only)
// @route   POST /api/group/start
// @desc    Start the battle (Host only)
// @access  Private
router.post('/start', verifyToken, async (req, res) => {
    const {
        code,
        categoryId,
        boardId,
        classId,
        streamId,
        semesterId,
        universityId,
        paperStageId,
        subjectId,
        chapterId,
        language = 'English'
    } = req.body;

    try {
        const sessionRes = await query('SELECT * FROM group_sessions WHERE id = $1', [code]);
        if (sessionRes.rows.length === 0) return res.status(404).json({ message: 'Session not found' });

        const session = sessionRes.rows[0];
        if (session.creator_id !== req.user.id) {
            return res.status(403).json({ message: 'Only host can start' });
        }

        // PRIME CHECK
        const creatorRes = await query('SELECT is_premium, sessions_left, role FROM users WHERE id = $1', [req.user.id]);
        const creator = creatorRes.rows[0];

        if (creator.role !== 'admin') {
            if (!creator.is_premium || creator.sessions_left <= 0) {
                return res.status(403).json({ message: 'Prime subscription required or sessions exhausted.', code: 'SESSIONS_EXHAUSTED' });
            }
            const newSessions = creator.sessions_left - 1;
            await query('UPDATE users SET sessions_left = $1, is_premium = $2 WHERE id = $3', [newSessions, newSessions > 0, req.user.id]);
        }

        // 1. Resolve Hierarchy IDs in Parallel
        const namePromises = [
            categoryId ? query('SELECT name FROM categories WHERE id = $1', [categoryId]) : Promise.resolve(null),
            boardId ? query('SELECT name FROM boards WHERE id = $1', [boardId]) : Promise.resolve(null),
            classId ? query('SELECT name FROM classes WHERE id = $1', [classId]) : Promise.resolve(null),
            paperStageId ? query('SELECT name FROM papers_stages WHERE id = $1', [paperStageId]) : Promise.resolve(null),
            streamId ? query('SELECT name FROM streams WHERE id = $1', [streamId]) : Promise.resolve(null),
            universityId ? query('SELECT name FROM universities WHERE id = $1', [universityId]) : Promise.resolve(null),
            semesterId ? query('SELECT name FROM semesters WHERE id = $1', [semesterId]) : Promise.resolve(null),
            subjectId ? query('SELECT name FROM subjects WHERE id = $1', [subjectId]) : Promise.resolve(null),
            chapterId ? query('SELECT name FROM chapters WHERE id = $1', [chapterId]) : Promise.resolve(null)
        ];

        const results = await Promise.all(namePromises);
        let topicParts = results.map(r => r?.rows?.[0]?.name).filter(Boolean);
        const topic = topicParts.length > 0 ? topicParts.join(' ') : 'General Knowledge';

        // 2. Generate 1st MCQ (Fast Start)
        console.log(`[GroupBattle] START: Generating 1st MCQ for: ${topic}`);
        const generatedMcqs = await generateMCQInitial(topic, 1, language);

        if (!generatedMcqs || generatedMcqs.length === 0) {
            return res.status(500).json({ message: 'Failed to generate initial question.' });
        }

        const firstQuestion = {
            id: `live_${Date.now()}_0`,
            ...generatedMcqs[0]
        };

        // 3. Update session
        await query(
            'UPDATE group_sessions SET status = \'active\', category_id = $1, mcq_data = $2 WHERE id = $3',
            [categoryId, JSON.stringify([firstQuestion]), code]
        );

        res.json({ message: 'Battle started', questions: [firstQuestion] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error starting battle' });
    }
});

// @route   POST /api/group/:code/next
// @desc    Get or generate next question (One-by-One)
// @access  Private
router.post('/:code/next', verifyToken, async (req, res) => {
    const { code } = req.params;
    const { language = 'English' } = req.body;

    try {
        const sessionRes = await query('SELECT * FROM group_sessions WHERE id = $1', [code]);
        if (sessionRes.rows.length === 0) return res.status(404).json({ message: 'Session not found' });

        const session = sessionRes.rows[0];
        let currentQuestions = typeof session.mcq_data === 'string' ? JSON.parse(session.mcq_data) : (session.mcq_data || []);

        if (currentQuestions.length >= 10) {
            return res.json({ message: 'Session complete', questions: currentQuestions });
        }

        // 1. Re-resolve topic (or we could cache it, but parallel is fast)
        const { category_id: categoryId } = session;
        // In a real app we'd fetch other IDs from the session or request body
        // For now, we'll re-resolve using whatever IDs we have in the session row if we added them, 
        // OR we can rely on the frontend sending them back.
        // Let's assume frontend sends the necessary context or we fetch name of category as fallback.
        const catRes = await query('SELECT name FROM categories WHERE id = $1', [categoryId]);
        const topic = catRes.rows[0]?.name || 'General Knowledge';

        console.log(`[GroupBattle] NEXT: Generating question ${currentQuestions.length + 1} for: ${topic}`);
        const generatedMcqs = await generateMCQInitial(topic, 1, language);

        if (!generatedMcqs || generatedMcqs.length === 0) {
            return res.status(500).json({ message: 'Failed to generate next question.' });
        }

        const nextQuestion = {
            id: `live_${Date.now()}_${currentQuestions.length}`,
            ...generatedMcqs[0]
        };

        const updatedQuestions = [...currentQuestions, nextQuestion];

        await query(
            'UPDATE group_sessions SET mcq_data = $1 WHERE id = $2',
            [JSON.stringify(updatedQuestions), code]
        );

        res.json({ message: 'Next question ready', questions: updatedQuestions });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error fetching next question' });
    }
});


// @route   GET /api/group/:id/leaderboard
// @desc    Get leaderboard for a session
// @access  Private
router.get('/:id/leaderboard', verifyToken, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await query(`
            SELECT u.username, gp.score, gp.joined_at
            FROM group_participants gp
            JOIN users u ON gp.user_id = u.id
            WHERE gp.session_id = $1
            ORDER BY gp.score DESC
        `, [id]);

        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/group/:id/submit
// @desc    Submit score for group session
// @access  Private
router.post('/:id/submit', verifyToken, async (req, res) => {
    const { id } = req.params;
    const { score } = req.body; // Score derived from frontend or calculated backend?

    try {
        await query(
            'UPDATE group_participants SET score = $1 WHERE session_id = $2 AND user_id = $3',
            [score, id, req.user.id]
        );
        res.json({ message: 'Score submitted' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
