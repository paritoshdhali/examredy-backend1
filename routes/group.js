const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { verifyToken } = require('../middleware/authMiddleware');
const crypto = require('crypto');

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
        if (session.status === 'active' && session.mcq_ids) {
            // Fetch the questions for the session
            const ids = typeof session.mcq_ids === 'string' ? JSON.parse(session.mcq_ids) : session.mcq_ids;
            const mcqRes = await query(`
                SELECT id, question, options, correct_option, explanation 
                FROM mcq_pool 
                WHERE id = ANY($1)
            `, [ids]);
            // Sort to match mcq_ids order
            questions = ids.map(id => mcqRes.rows.find(r => r.id === id)).filter(Boolean);
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
// @access  Private
router.post('/start', verifyToken, async (req, res) => {
    const { code, categoryId, boardId, classId, streamId, semesterId, universityId, paperStageId, subjectId, chapterId } = req.body;
    try {
        const sessionRes = await query('SELECT * FROM group_sessions WHERE id = $1', [code]);
        if (sessionRes.rows.length === 0) return res.status(404).json({ message: 'Session not found' });

        const session = sessionRes.rows[0];
        if (session.creator_id !== req.user.id) {
            return res.status(403).json({ message: 'Only host can start' });
        }

        // Build dynamic query for MCQs
        let mcqParams = [categoryId];
        let mcqQueryStr = `SELECT id, question, options, correct_option, explanation FROM mcq_pool WHERE category_id = $1 AND is_approved = TRUE`;

        if (chapterId) {
            mcqParams.push(chapterId);
            mcqQueryStr += ` AND chapter_id = $${mcqParams.length}`;
        } else if (subjectId) { // If chapterId is not provided, try subjectId
            mcqParams.push(subjectId);
            mcqQueryStr += ` AND subject_id = $${mcqParams.length}`;
        }

        // Add additional filters if provided
        if (boardId) { mcqParams.push(boardId); mcqQueryStr += ` AND board_id = $${mcqParams.length}`; }
        if (classId) { mcqParams.push(classId); mcqQueryStr += ` AND class_id = $${mcqParams.length}`; }
        if (streamId) { mcqParams.push(streamId); mcqQueryStr += ` AND stream_id = $${mcqParams.length}`; }
        if (semesterId) { mcqParams.push(semesterId); mcqQueryStr += ` AND semester_id = $${mcqParams.length}`; }
        if (universityId) { mcqParams.push(universityId); mcqQueryStr += ` AND university_id = $${mcqParams.length}`; }
        if (paperStageId) { mcqParams.push(paperStageId); mcqQueryStr += ` AND paper_stage_id = $${mcqParams.length}`; }

        mcqQueryStr += ` ORDER BY RANDOM() LIMIT 10`;

        const mcqQuery = await query(mcqQueryStr, mcqParams);

        if (mcqQuery.rows.length === 0) {
            return res.status(400).json({ message: 'No questions available for this selection' });
        }

        const questions = mcqQuery.rows;
        const mcqIds = questions.map(r => r.id);

        await query(
            'UPDATE group_sessions SET status = \'active\', category_id = $1, mcq_ids = $2 WHERE id = $3',
            [categoryId, JSON.stringify(mcqIds), code]
        );

        res.json({ message: 'Battle started', questions });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
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
