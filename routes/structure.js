const express = require('express');
const router = express.Router();
const { query } = require('../db');

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

module.exports = router;
