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

const { generateMCQInitial, fetchAIStructure } = require('../services/aiService');

// @route   POST /api/ai-fetch/boards
router.post('/boards', verifyToken, admin, async (req, res) => {
    const { state_id, state_name } = req.body;
    try {
        const boards = await fetchAIStructure('Education Boards', `State of ${state_name}, India`);
        const saved = [];
        for (const name of boards) {
            const result = await query('INSERT INTO boards (name, state_id, is_approved) VALUES ($1, $2, $3) RETURNING *', [name, state_id, false]);
            saved.push(result.rows[0]);
        }
        res.json({ message: `${boards.length} Boards fetched and saved as pending approval`, data: saved });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// @route   POST /api/ai-fetch/universities
router.post('/universities', verifyToken, admin, async (req, res) => {
    const { state_id, state_name } = req.body;
    try {
        const universities = await fetchAIStructure('Universities', `State of ${state_name}, India`);
        const saved = [];
        for (const name of universities) {
            const result = await query('INSERT INTO universities (name, state_id, is_approved) VALUES ($1, $2, $3) RETURNING *', [name, state_id, false]);
            saved.push(result.rows[0]);
        }
        res.json({ message: `${universities.length} Universities fetched and saved as pending approval`, data: saved });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// @route   POST /api/ai-fetch/papers
router.post('/papers', verifyToken, admin, async (req, res) => {
    const { category_id, category_name } = req.body;
    try {
        const papers = await fetchAIStructure('Papers/Stages', `Exam Category: ${category_name}`);
        const saved = [];
        for (const name of papers) {
            const result = await query('INSERT INTO papers_stages (name, category_id, is_approved) VALUES ($1, $2, $3) RETURNING *', [name, category_id, false]);
            saved.push(result.rows[0]);
        }
        res.json({ message: `${papers.length} Papers/Stages fetched and saved as pending approval`, data: saved });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// @route   POST /api/ai-fetch/subjects
router.post('/subjects', verifyToken, admin, async (req, res) => {
    const { category_id, board_id, university_id, class_id, stream_id, semester_id, degree_type_id, paper_stage_id, context_name } = req.body;
    try {
        const subjects = await fetchAIStructure('Subjects', `Context: ${context_name}`);
        const saved = [];
        for (const name of subjects) {
            const result = await query(
                `INSERT INTO subjects (
                    name, category_id, board_id, university_id, class_id, stream_id, 
                    semester_id, degree_type_id, paper_stage_id, is_approved
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
                [name, category_id, board_id, university_id, class_id, stream_id, semester_id, degree_type_id, paper_stage_id, false]
            );
            saved.push(result.rows[0]);
        }
        res.json({ message: `${subjects.length} Subjects fetched and saved as pending approval`, data: saved });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// @route   POST /api/ai-fetch/chapters
router.post('/chapters', verifyToken, admin, async (req, res) => {
    const { subject_id, subject_name } = req.body;
    try {
        const chapters = await fetchAIStructure('Chapters', `Subject: ${subject_name}`);
        const saved = [];
        for (const name of chapters) {
            const result = await query('INSERT INTO chapters (name, subject_id, is_approved) VALUES ($1, $2, $3) RETURNING *', [name, subject_id, false]);
            saved.push(result.rows[0]);
        }
        res.json({ message: `${chapters.length} Chapters fetched and saved as pending approval`, data: saved });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
