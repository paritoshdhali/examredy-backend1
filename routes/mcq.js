const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { pool, query } = require('../db');
const { verifyToken, admin } = require('../middleware/authMiddleware');
const { generateMCQInitial } = require('../services/aiService');
const { subscriptionCheck } = require('../middleware/subscriptionMiddleware');

// @route   GET /api/mcq
// @desc    MCQ health check
// @access  Public
router.get('/', (req, res) => {
    res.json({ message: 'MCQ service is running' });
});

// @route   POST /api/mcq/generate
// @desc    Generate MCQs using AI (Admin only)
// @access  Admin
router.post('/generate', verifyToken, admin, async (req, res) => {
    const { topic, category_id, count } = req.body;

    if (!topic || !category_id) {
        return res.status(400).json({ message: 'Topic and Category are required' });
    }

    try {
        const mcqs = await generateMCQInitial(topic, count || 5);

        // Save to DB with Duplicate Prevention
        const savedMcqs = [];
        for (const mcq of mcqs) {
            // Generate SHA-256 Hash of question text (strict normalization)
            const normalizedQuestion = mcq.question.trim().toLowerCase().replace(/\s+/g, ' ');
            const hash = crypto.createHash('sha256').update(normalizedQuestion).digest('hex');

            try {
                const result = await query(
                    `INSERT INTO mcq_pool (question, options, correct_option, explanation, category_id, subject, chapter, is_approved, question_hash) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
                     ON CONFLICT (question_hash) DO NOTHING 
                     RETURNING *`,
                    [mcq.question, JSON.stringify(mcq.options), mcq.correct_option, mcq.explanation, category_id, mcq.subject, mcq.chapter, true, hash]
                );

                if (result.rows.length > 0) {
                    savedMcqs.push(result.rows[0]);
                }
            } catch (dbErr) {
                console.error('Individual MCQ Save Error:', dbErr.message);
                // Continue to next MCQ
            }
        }

        res.json({ message: 'Generation complete', total: mcqs.length, saved: savedMcqs.length, data: savedMcqs });
    } catch (error) {
        console.error('AI Strategy Error:', error);
        res.status(500).json({ message: 'AI generation orchestration failed' });
    }
});

// @route   GET /api/mcq/practice
// @desc    Get MCQs for practice
// @access  Private (with limits)
router.get('/practice', verifyToken, subscriptionCheck, async (req, res) => {
    const { category_id, limit = 10 } = req.query;
    const client = await pool.connect(); // Use direct client for transaction

    try {
        // Free user check via Transaction (Avoid Race Condition)
        if (!req.isPremium) {
            await client.query('BEGIN');

            const settingsResult = await client.query('SELECT key, value FROM free_limit_settings');
            const settings = Object.fromEntries(settingsResult.rows.map(r => [r.key, r.value]));
            const freeLimit = parseInt(settings['FREE_SESSIONS_COUNT'] || '2');
            const mcqsPerSession = parseInt(settings['FREE_SESSION_MCQS'] || '10');

            // Lock row for update
            const usageResult = await client.query(
                `SELECT count FROM user_daily_usage WHERE user_id = $1 AND date = CURRENT_DATE FOR UPDATE`,
                [req.user.id]
            );

            let dailyCount = 0;
            if (usageResult.rows.length > 0) {
                dailyCount = usageResult.rows[0].count;
            }

            if (dailyCount >= freeLimit) {
                await client.query('ROLLBACK');
                return res.status(403).json({
                    message: 'Daily free limit reached',
                    code: 'LIMIT_REACHED',
                    popup: {
                        heading: settings['POPUP_HEADING'],
                        text: settings['POPUP_TEXT']
                    }
                });
            }

            // Valid usage, increment count
            await client.query(`
                INSERT INTO user_daily_usage (user_id, date, count)
                VALUES ($1, CURRENT_DATE, 1)
                ON CONFLICT (user_id, date)
                DO UPDATE SET count = user_daily_usage.count + 1
             `, [req.user.id]);

            await client.query('COMMIT');

            // Override limit from query if free user
            requestedLimit = mcqsPerSession;
        } else {
            requestedLimit = parseInt(limit);
        }

        // Optimized Random Fetch (SYSTEM Sampling - ID based random is better but complex to implement without gap analysis, SYSTEM is fast for large tables)
        // For strict correctness with gaps, we often use: WHERE id IN (SELECT id FROM mcq_pool ORDER BY RANDOM() LIMIT N) - still slow?
        // Let's use TABLESAMPLE if supported (Postgres 9.5+) or OFFSET-LIMIT optimization logic requested.
        // Requested Logic: "SELECT * FROM mcq_pool ... AND id >= (SELECT FLOOR(RANDOM() * MAX(id))) LIMIT 10"

        // Simpler reliable approach for moderate datasets without heavy performance hit like direct ORDER BY RANDOM():
        // We will stick to ORDER BY RANDOM() LIMIT 10 IF dataset is small (<10k), but user asked to REMOVE IT due to scale.
        // Let's implement the suggested ID seeking approach.

        // Fallback for empty table check
        const maxIdResult = await query('SELECT MAX(id) FROM mcq_pool');
        const maxId = maxIdResult.rows[0].max;

        let result;
        if (!maxId) {
            result = { rows: [] };
        } else {
            // Try to fetch starting from a random ID
            const randomId = Math.floor(Math.random() * maxId);
            result = await query(
                `SELECT id, question, options, subject, chapter 
                 FROM mcq_pool 
                 WHERE category_id = $1 AND is_approved = TRUE AND id >= $2
                 LIMIT $3`,
                [category_id, randomId, requestedLimit]
            );

            if (result.rows.length < requestedLimit) {
                const fallback = await query(
                    'SELECT id, question, options, subject, chapter FROM mcq_pool WHERE category_id = $1 AND is_approved = TRUE LIMIT $2',
                    [category_id, requestedLimit]
                );
                result = fallback;
            }
        }

        res.json(result.rows);
    } catch (error) {
        if (!req.isPremium) await client.query('ROLLBACK');
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        client.release();
    }
});

// @route   POST /api/mcq/generate-practice
// @desc    Generate MCQs on-the-fly for practice (Live AI)
// @access  Private (with limits)
router.post('/generate-practice', verifyToken, subscriptionCheck, async (req, res) => {
    const { topic, language = 'English', limit = 10 } = req.body;

    if (!topic) {
        return res.status(400).json({ message: 'Topic is required for practice generation' });
    }

    const client = await pool.connect();

    try {
        let requestedLimit = limit;
        // Free user check via Transaction (Avoid Race Condition)
        if (!req.isPremium) {
            await client.query('BEGIN');

            const settingsResult = await client.query('SELECT key, value FROM free_limit_settings');
            const settings = Object.fromEntries(settingsResult.rows.map(r => [r.key, r.value]));
            const freeLimit = parseInt(settings['FREE_SESSIONS_COUNT'] || '2');
            const mcqsPerSession = parseInt(settings['FREE_SESSION_MCQS'] || '10');

            // Lock row for update
            const usageResult = await client.query(
                `SELECT count FROM user_daily_usage WHERE user_id = $1 AND date = CURRENT_DATE FOR UPDATE`,
                [req.user.id]
            );

            let dailyCount = 0;
            if (usageResult.rows.length > 0) {
                dailyCount = usageResult.rows[0].count;
            }

            if (dailyCount >= freeLimit) {
                await client.query('ROLLBACK');
                return res.status(403).json({
                    message: 'Daily free limit reached',
                    code: 'LIMIT_REACHED',
                    popup: {
                        heading: settings['POPUP_HEADING'],
                        text: settings['POPUP_TEXT']
                    }
                });
            }

            // Valid usage, increment count
            await client.query(`
                INSERT INTO user_daily_usage (user_id, date, count)
                VALUES ($1, CURRENT_DATE, 1)
                ON CONFLICT (user_id, date)
                DO UPDATE SET count = user_daily_usage.count + 1
             `, [req.user.id]);

            await client.query('COMMIT');

            // Override limit from query if free user
            requestedLimit = mcqsPerSession;
        } else {
            requestedLimit = parseInt(limit);
        }

        // Generate MCQs ON THE FLY without saving to DB
        const generatedQs = await generateMCQInitial(topic, requestedLimit, language);

        // Ensure IDs exist for MCQSession.jsx component tracking (synthetic IDs)
        const finalQs = generatedQs.map((q, idx) => ({
            id: `live_${Date.now()}_${idx}`,
            ...q
        }));

        res.json(finalQs);
    } catch (error) {
        if (!req.isPremium) {
            try { await client.query('ROLLBACK'); } catch (e) { }
        }
        console.error('Live Generataion Error:', error);
        res.status(500).json({ message: 'Error generating practice session' });
    } finally {
        client.release();
    }
});

// @route   POST /api/mcq/submit
// @desc    Submit answer and get result
// @access  Private
router.post('/submit', verifyToken, async (req, res) => {
    const { mcq_id, selected_option } = req.body;

    try {
        // Check if synthetic ID
        if (typeof mcq_id === 'string' && mcq_id.startsWith('live_')) {
            // For live-generated MCQs, we can't look up correct answer in DB.
            // Client MUST send the known correct option OR we don't track history for them yet.
            const { actual_correct_option } = req.body;
            const isCorrect = actual_correct_option === selected_option;

            // Note: We can't insert into user_mcq_history because there is no true mcq_id integer.
            // But we can return success so the UI stays green/red.
            return res.json({
                is_correct: isCorrect,
                correct_option: actual_correct_option
            });
        }

        const result = await query('SELECT * FROM mcq_pool WHERE id = $1', [mcq_id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'MCQ not found' });
        }

        const mcq = result.rows[0];
        const isCorrect = mcq.correct_option === selected_option;

        // Save history
        await query(
            'INSERT INTO user_mcq_history (user_id, mcq_id, is_correct) VALUES ($1, $2, $3)',
            [req.user.id, mcq_id, isCorrect]
        );

        res.json({
            is_correct: isCorrect,
            explanation: mcq.explanation,
            correct_option: mcq.correct_option
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;

