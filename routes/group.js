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

        // PRIME CHECK: Decrement creator's session
        const creatorRes = await query('SELECT is_premium, sessions_left, role FROM users WHERE id = $1', [req.user.id]);
        const creator = creatorRes.rows[0];

        if (creator.role !== 'admin') {
            if (!creator.is_premium || creator.sessions_left <= 0) {
                return res.status(403).json({ message: 'Prime subscription required or sessions exhausted to start a group battle.', code: 'SESSIONS_EXHAUSTED' });
            }
            const newSessions = creator.sessions_left - 1;
            await query('UPDATE users SET sessions_left = $1, is_premium = $2 WHERE id = $3', [newSessions, newSessions > 0, req.user.id]);
        }

        // 1. Resolve Hierarchy IDs to Topic Name
        let topicParts = [];

        // Category
        if (categoryId) {
            const cat = await query('SELECT name FROM categories WHERE id = $1', [categoryId]);
            if (cat.rows[0]) topicParts.push(cat.rows[0].name);
        }
        // Board
        if (boardId) {
            const board = await query('SELECT name FROM boards WHERE id = $1', [boardId]);
            if (board.rows[0]) topicParts.push(board.rows[0].name);
        }
        // Class
        if (classId) {
            const cls = await query('SELECT name FROM classes WHERE id = $1', [classId]);
            if (cls.rows[0]) topicParts.push(cls.rows[0].name);
        }
        // Stream
        if (streamId) {
            const stream = await query('SELECT name FROM streams WHERE id = $1', [streamId]);
            if (stream.rows[0]) topicParts.push(stream.rows[0].name);
        }
        // University
        if (universityId) {
            const uni = await query('SELECT name FROM universities WHERE id = $1', [universityId]);
            if (uni.rows[0]) topicParts.push(uni.rows[0].name);
        }
        // Subject
        if (subjectId) {
            const sub = await query('SELECT name FROM subjects WHERE id = $1', [subjectId]);
            if (sub.rows[0]) topicParts.push(sub.rows[0].name);
        }
        // Chapter
        if (chapterId) {
            const chap = await query('SELECT name FROM chapters WHERE id = $1', [chapterId]);
            if (chap.rows[0]) topicParts.push(chap.rows[0].name);
        }

        const topic = topicParts.length > 0 ? topicParts.join(' ') : 'General Knowledge';

        // 2. Generate MCQs using AI
        console.log(`[GroupBattle] Generating 10 MCQs for topic: ${topic} in ${language}`);
        const generatedMcqs = await generateMCQInitial(topic, 10, language);

        if (!generatedMcqs || generatedMcqs.length === 0) {
            return res.status(500).json({ message: 'Failed to generate questions. Please try again.' });
        }

        // 3. Prepare synthetic MCQs without saving to global database
        const finalQuestions = generatedMcqs.map((q, idx) => ({
            id: `live_${Date.now()}_${idx}`,
            question: q.question,
            options: q.options,
            correct_option: q.correct_option,
            explanation: q.explanation
        }));

        if (finalQuestions.length === 0) {
            return res.status(500).json({ message: 'Failed to generate valid questions.' });
        }

        // 4. Update session with raw MCQ data
        await query(
            'UPDATE group_sessions SET status = \'active\', category_id = $1, mcq_data = $2 WHERE id = $3',
            [categoryId, JSON.stringify(finalQuestions), code]
        );

        res.json({ message: 'Battle started', questions: finalQuestions });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error starting battle' });
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
