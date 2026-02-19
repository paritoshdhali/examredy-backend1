const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { verifyToken, admin } = require('../middleware/authMiddleware');
const { hashPassword, comparePassword, generateToken } = require('../utils/helpers');

// @route   GET /api/admin/diagnostic
// @desc    Check DB status and admin existence (Diagnostic only)
router.get('/diagnostic', async (req, res) => {
    try {
        const result = await query('SELECT id, username, email, role, (password IS NOT NULL) as has_password, length(password) as pass_len FROM users WHERE email = $1', ['admin@examredy.in']);
        res.json({
            database: 'Connected',
            adminStatus: result.rows.length > 0 ? 'Found' : 'Not Found',
            adminDetails: result.rows[0] || null,
            env: {
                node_env: process.env.NODE_ENV,
                has_jwt_secret: !!process.env.JWT_SECRET
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// @route   GET /api/admin/debug-token
// @desc    Debug Authorization header (No verifyToken middleware)
router.get('/debug-token', (req, res) => {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    res.json({
        exists: !!authHeader,
        format_valid: authHeader ? authHeader.toLowerCase().startsWith('bearer ') : false,
        header_prefix: authHeader ? authHeader.substring(0, 10) : null,
        received_at: new Date().toISOString()
    });
});

// @route   POST /api/admin/login
// @desc    Admin Login
// @access  Public
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    console.log(`[AUTH-DEBUG] Login attempt for: ${email}`);

    try {
        // Log query start
        const result = await query('SELECT id, username, email, password, role FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        if (!user) {
            console.log(`[AUTH] Admin login attempt failed: User not found (${email})`);
            return res.status(401).json({ message: 'Invalid admin credentials (User not found)' });
        }

        console.log(`[AUTH-DEBUG] User found: ${user.email}, Role: ${user.role}`);

        if (user.role !== 'admin') {
            console.log(`[AUTH] Admin login attempt failed: User ${email} has role ${user.role}`);
            return res.status(403).json({ message: 'Not authorized, admin role required' });
        }

        const isMatch = await comparePassword(password, user.password);
        console.log(`[AUTH-DEBUG] Password match result: ${isMatch}`);

        if (!isMatch) {
            console.log(`[AUTH] Admin login attempt failed: Password mismatch for ${email}`);
            return res.status(401).json({ message: 'Invalid admin credentials (Password mismatch)' });
        }

        const token = generateToken(user.id, user.role, user.email);

        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        console.error('Admin Login Error:', error);
        res.status(500).json({ message: 'Server error during admin login' });
    }
});

// @route   GET /api/admin/test
// @desc    Admin health check (unprotected)
router.get('/test', (req, res) => {
    res.json({ message: 'Admin API is accessible' });
});

// Middleware to protect subsequent admin routes
router.use(verifyToken, admin);

// @route   GET /api/admin
// @desc    Admin service health check
router.get('/', (req, res) => {
    res.json({ message: 'Admin service is running' });
});

// @route   GET /api/admin/stats
// @desc    Get comprehensive dashboard stats
router.get('/stats', async (req, res) => {
    try {
        // Basic Stats
        const users = await query('SELECT COUNT(*) FROM users');
        const mcqs = await query('SELECT COUNT(*) FROM mcq_pool');

        // Time-based Stats (Mocking date ranges for simplicity, ideal is dynamic intervals)
        const usersToday = await query('SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE');
        const usersYesterday = await query('SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE - INTERVAL \'1 day\' AND created_at < CURRENT_DATE');

        // Revenue (Today, Monthly, Yearly)
        const revToday = await query('SELECT SUM(amount) FROM payments WHERE status = \'captured\' AND created_at >= CURRENT_DATE');
        const revMonthly = await query('SELECT SUM(amount) FROM payments WHERE status = \'captured\' AND created_at >= date_trunc(\'month\', CURRENT_DATE)');
        const revYearly = await query('SELECT SUM(amount) FROM payments WHERE status = \'captured\' AND created_at >= date_trunc(\'year\', CURRENT_DATE)');

        // Active Users (Simple count from session table or just unique active users in usage logs)
        const activeUsersCount = await query('SELECT COUNT(DISTINCT user_id) FROM user_daily_usage WHERE date = CURRENT_DATE');

        res.json({
            activeUsers: parseInt(activeUsersCount.rows[0]?.count || 0),
            totalUsersToday: parseInt(usersToday.rows[0]?.count || 0),
            totalUsersYesterday: parseInt(usersYesterday.rows[0]?.count || 0),
            totalUsers: parseInt(users.rows[0]?.count || 0),
            totalMcqsGenerated: parseInt(mcqs.rows[0]?.count || 0),
            revenueToday: parseFloat(revToday.rows[0]?.sum || 0),
            revenueMonthly: parseFloat(revMonthly.rows[0]?.sum || 0),
            revenueYearly: parseFloat(revYearly.rows[0]?.sum || 0)
        });
    } catch (error) {
        console.error('Admin Stats Error:', error.message);
        res.status(500).json({ message: 'Failed to fetch dashboard stats' });
    }
});

// --- USER MANAGEMENT ---

// @route   GET /api/admin/users
router.get('/users', async (req, res) => {
    const { page = 1, limit = 20, search = '' } = req.query;
    const offset = (page - 1) * limit;
    try {
        let q = 'SELECT id, username, email, role, is_premium, premium_expiry, created_at, is_active FROM users';
        let countQ = 'SELECT COUNT(*) FROM users';
        const params = [];

        if (search) {
            q += ' WHERE email ILIKE $1 OR username ILIKE $1';
            countQ += ' WHERE email ILIKE $1 OR username ILIKE $1';
            params.push(`%${search}%`);
        }

        q += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        const result = await query(q, [...params, limit, offset]);
        const countRes = await query(countQ, params);

        res.json({
            users: result.rows,
            total: parseInt(countRes.rows[0].count),
            pages: Math.ceil(parseInt(countRes.rows[0].count) / limit)
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching users' });
    }
});

// @route   PUT /api/admin/users/:id/status
router.put('/users/:id/status', async (req, res) => {
    const { is_active } = req.body;
    try {
        await query('UPDATE users SET is_active = $1 WHERE id = $2', [is_active, req.params.id]);
        res.json({ message: `User ${is_active ? 'enabled' : 'disabled'}` });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update user status' });
    }
});

// @route   PUT /api/admin/users/:id/subscription
router.put('/users/:id/subscription', async (req, res) => {
    const { action } = req.body; // 'extend' or 'reduce'
    const hours = action === 'extend' ? 24 : -24; // Simple 24h adjustment
    try {
        await query('UPDATE users SET premium_expiry = COALESCE(premium_expiry, CURRENT_TIMESTAMP) + $1 * INTERVAL \'1 hour\', is_premium = TRUE WHERE id = $2', [hours, req.params.id]);
        res.json({ message: 'Subscription updated' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update subscription' });
    }
});

// --- CATEGORY & STRUCTURE ---

// @route   GET /api/admin/categories
router.get('/categories', async (req, res) => {
    const result = await query('SELECT * FROM categories ORDER BY sort_order ASC');
    res.json(result.rows);
});

// @route   POST /api/admin/categories
router.post('/categories', async (req, res) => {
    const { name, image_url, description, sort_order } = req.body;
    try {
        const result = await query('INSERT INTO categories (name, image_url, description, sort_order) VALUES ($1,$2,$3,$4) RETURNING *', [name, image_url, description, sort_order || 0]);
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ message: 'Failed to create category' });
    }
});

// @route   PUT /api/admin/categories/:id
router.put('/categories/:id', async (req, res) => {
    const { name, image_url, description, sort_order, is_active } = req.body;
    try {
        await query('UPDATE categories SET name=$1, image_url=$2, description=$3, sort_order=$4, is_active=$5 WHERE id=$6', [name, image_url, description, sort_order, is_active, req.params.id]);
        res.json({ message: 'Category updated' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update category' });
    }
});

// --- MCQ CONTROL ---

// @route   GET /api/admin/mcqs
router.get('/mcqs', async (req, res) => {
    const { page = 1, limit = 20, status = 'all' } = req.query;
    const offset = (page - 1) * limit;
    let q = 'SELECT * FROM mcq_pool';
    if (status === 'pending') q += ' WHERE is_approved = FALSE';
    else if (status === 'approved') q += ' WHERE is_approved = TRUE';
    q += ' ORDER BY created_at DESC LIMIT $1 OFFSET $2';
    const result = await query(q, [limit, offset]);
    res.json(result.rows);
});

// @route   PUT /api/admin/mcqs/:id/approve
router.put('/mcqs/:id/approve', async (req, res) => {
    await query('UPDATE mcq_pool SET is_approved = TRUE WHERE id = $1', [req.params.id]);
    res.json({ message: 'MCQ Approved' });
});

// @route   DELETE /api/admin/mcqs/:id
router.delete('/mcqs/:id', async (req, res) => {
    await query('DELETE FROM mcq_pool WHERE id = $1', [req.params.id]);
    res.json({ message: 'MCQ Deleted' });
});

// --- SITE & SYSTEM SETTINGS ---

// @route   GET /api/admin/settings
router.get('/settings', async (req, res) => {
    const settings = await query('SELECT * FROM system_settings');
    const legal = await query('SELECT * FROM legal_pages');
    const payment = await query('SELECT * FROM payment_gateway_settings');
    const ai = await query('SELECT * FROM ai_providers');

    const formattedSettings = {};
    settings.rows.forEach(s => formattedSettings[s.key] = s.value);

    res.json({
        system: formattedSettings,
        legalPages: legal.rows,
        payments: payment.rows,
        aiProviders: ai.rows
    });
});

// @route   PUT /api/admin/settings/system
router.put('/settings/system', async (req, res) => {
    const settings = req.body;
    try {
        for (const [key, value] of Object.entries(settings)) {
            await query('INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, String(value)]);
        }
        res.json({ message: 'System settings updated' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update settings' });
    }
});

// @route   PUT /api/admin/settings/legal/:slug
router.put('/settings/legal/:slug', async (req, res) => {
    const { content, title } = req.body;
    try {
        await query('UPDATE legal_pages SET content = $1, title = $2, updated_at = CURRENT_TIMESTAMP WHERE slug = $3', [content, title, req.params.slug]);
        res.json({ message: 'Legal page updated' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update legal page' });
    }
});

// @route   PUT /api/admin/settings/ai/:id
router.put('/settings/ai/:id', async (req, res) => {
    const { name, base_url, api_key, model_name, is_active } = req.body;
    try {
        if (is_active) {
            // Deactivate others if this one is being activated
            await query('UPDATE ai_providers SET is_active = FALSE');
        }
        await query(
            'UPDATE ai_providers SET name=$1, base_url=$2, api_key=$3, model_name=$4, is_active=$5 WHERE id=$6',
            [name, base_url, api_key, model_name, is_active, req.params.id]
        );
        res.json({ message: 'AI Provider updated' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update AI provider' });
    }
});

// --- STRUCTURE MANAGEMENT ---

// @route   GET /api/admin/states
router.get('/states', async (req, res) => {
    const result = await query('SELECT * FROM states ORDER BY name ASC');
    res.json(result.rows);
});

// @route   POST /api/admin/states
router.post('/states', async (req, res) => {
    const { name } = req.body;
    const result = await query('INSERT INTO states (name) VALUES ($1) RETURNING *', [name]);
    res.json(result.rows[0]);
});

// @route   PUT /api/admin/states/:id
router.put('/states/:id', async (req, res) => {
    const { name } = req.body;
    await query('UPDATE states SET name = $1 WHERE id = $2', [name, req.params.id]);
    res.json({ message: 'State updated' });
});

// @route   DELETE /api/admin/states/:id
router.delete('/states/:id', async (req, res) => {
    await query('DELETE FROM states WHERE id = $1', [req.params.id]);
    res.json({ message: 'State deleted' });
});

// --- LANGUAGES ---

// @route   GET /api/admin/languages
router.get('/languages', async (req, res) => {
    const result = await query('SELECT * FROM languages ORDER BY name ASC');
    res.json(result.rows);
});

// @route   POST /api/admin/languages
router.post('/languages', async (req, res) => {
    const { name } = req.body;
    const result = await query('INSERT INTO languages (name) VALUES ($1) RETURNING *', [name]);
    res.json(result.rows[0]);
});

// @route   PUT /api/admin/languages/:id
router.put('/languages/:id', async (req, res) => {
    const { name } = req.body;
    await query('UPDATE languages SET name = $1 WHERE id = $2', [name, req.params.id]);
    res.json({ message: 'Language updated' });
});

// @route   DELETE /api/admin/languages/:id
router.delete('/languages/:id', async (req, res) => {
    await query('DELETE FROM languages WHERE id = $1', [req.params.id]);
    res.json({ message: 'Language deleted' });
});

// --- BOARDS ---

// @route   GET /api/admin/boards
router.get('/boards', async (req, res) => {
    const result = await query(`
        SELECT b.*, s.name as state_name 
        FROM boards b 
        LEFT JOIN states s ON b.state_id = s.id 
        ORDER BY b.name ASC
    `);
    res.json(result.rows);
});

// @route   POST /api/admin/boards
router.post('/boards', async (req, res) => {
    const { name, state_id, is_active } = req.body;
    const result = await query('INSERT INTO boards (name, state_id, is_active) VALUES ($1, $2, $3) RETURNING *', [name, state_id, is_active !== false]);
    res.json(result.rows[0]);
});

// @route   PUT /api/admin/boards/:id
router.put('/boards/:id', async (req, res) => {
    const { name, state_id, is_active } = req.body;
    await query('UPDATE boards SET name = $1, state_id = $2, is_active = $3 WHERE id = $4', [name, state_id, is_active, req.params.id]);
    res.json({ message: 'Board updated' });
});

// @route   DELETE /api/admin/boards/:id
router.delete('/boards/:id', async (req, res) => {
    await query('DELETE FROM boards WHERE id = $1', [req.params.id]);
    res.json({ message: 'Board deleted' });
});

// --- CLASSES ---

// @route   GET /api/admin/classes
router.get('/classes', async (req, res) => {
    const result = await query('SELECT * FROM classes ORDER BY id ASC');
    res.json(result.rows);
});

// @route   POST /api/admin/classes
router.post('/classes', async (req, res) => {
    const { name, is_active } = req.body;
    const result = await query('INSERT INTO classes (name, is_active) VALUES ($1, $2) RETURNING *', [name, is_active !== false]);
    res.json(result.rows[0]);
});

// @route   PUT /api/admin/classes/:id
router.put('/classes/:id', async (req, res) => {
    const { name, is_active } = req.body;
    await query('UPDATE classes SET name = $1, is_active = $2 WHERE id = $3', [name, is_active, req.params.id]);
    res.json({ message: 'Class updated' });
});

// @route   DELETE /api/admin/classes/:id
router.delete('/classes/:id', async (req, res) => {
    await query('DELETE FROM classes WHERE id = $1', [req.params.id]);
    res.json({ message: 'Class deleted' });
});

// --- STREAMS ---

// @route   GET /api/admin/streams
router.get('/streams', async (req, res) => {
    const result = await query('SELECT * FROM streams ORDER BY name ASC');
    res.json(result.rows);
});

// @route   POST /api/admin/streams
router.post('/streams', async (req, res) => {
    const { name, is_active } = req.body;
    const result = await query('INSERT INTO streams (name, is_active) VALUES ($1, $2) RETURNING *', [name, is_active !== false]);
    res.json(result.rows[0]);
});

// @route   PUT /api/admin/streams/:id
router.put('/streams/:id', async (req, res) => {
    const { name, is_active } = req.body;
    await query('UPDATE streams SET name = $1, is_active = $2 WHERE id = $3', [name, is_active, req.params.id]);
    res.json({ message: 'Stream updated' });
});

// @route   DELETE /api/admin/streams/:id
router.delete('/streams/:id', async (req, res) => {
    await query('DELETE FROM streams WHERE id = $1', [req.params.id]);
    res.json({ message: 'Stream deleted' });
});

// --- SUBJECTS ---

// @route   GET /api/admin/subjects
router.get('/subjects', async (req, res) => {
    const result = await query(`
        SELECT sub.*, b.name as board_name, c.name as class_name, str.name as stream_name
        FROM subjects sub
        LEFT JOIN boards b ON sub.board_id = b.id
        LEFT JOIN classes c ON sub.class_id = c.id
        LEFT JOIN streams str ON sub.stream_id = str.id
        ORDER BY sub.name ASC
    `);
    res.json(result.rows);
});

// @route   POST /api/admin/subjects
router.post('/subjects', async (req, res) => {
    const { name, class_id, board_id, stream_id, semester_id, is_active } = req.body;
    const result = await query(
        'INSERT INTO subjects (name, class_id, board_id, stream_id, semester_id, is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [name, class_id, board_id, stream_id, semester_id, is_active !== false]
    );
    res.json(result.rows[0]);
});

// @route   PUT /api/admin/subjects/:id
router.put('/subjects/:id', async (req, res) => {
    const { name, class_id, board_id, stream_id, semester_id, is_active } = req.body;
    await query(
        'UPDATE subjects SET name=$1, class_id=$2, board_id=$3, stream_id=$4, semester_id=$5, is_active=$6 WHERE id=$7',
        [name, class_id, board_id, stream_id, semester_id, is_active, req.params.id]
    );
    res.json({ message: 'Subject updated' });
});

// @route   DELETE /api/admin/subjects/:id
router.delete('/subjects/:id', async (req, res) => {
    await query('DELETE FROM subjects WHERE id = $1', [req.params.id]);
    res.json({ message: 'Subject deleted' });
});

// --- CHAPTERS ---

// @route   GET /api/admin/chapters
router.get('/chapters', async (req, res) => {
    const result = await query(`
        SELECT ch.*, sub.name as subject_name
        FROM chapters ch
        LEFT JOIN subjects sub ON ch.subject_id = sub.id
        ORDER BY ch.name ASC
    `);
    res.json(result.rows);
});

// @route   POST /api/admin/chapters
router.post('/chapters', async (req, res) => {
    const { name, subject_id, is_active } = req.body;
    const result = await query('INSERT INTO chapters (name, subject_id, is_active) VALUES ($1, $2, $3) RETURNING *', [name, subject_id, is_active !== false]);
    res.json(result.rows[0]);
});

// @route   PUT /api/admin/chapters/:id
router.put('/chapters/:id', async (req, res) => {
    const { name, subject_id, is_active } = req.body;
    await query('UPDATE chapters SET name=$1, subject_id=$2, is_active=$3 WHERE id=$4', [name, subject_id, is_active, req.params.id]);
    res.json({ message: 'Chapter updated' });
});

// @route   DELETE /api/admin/chapters/:id
router.delete('/chapters/:id', async (req, res) => {
    await query('DELETE FROM chapters WHERE id = $1', [req.params.id]);
    res.json({ message: 'Chapter deleted' });
});

// --- SUBSCRIPTION PLANS ---

// @route   GET /api/admin/plans
router.get('/plans', async (req, res) => {
    const result = await query('SELECT * FROM subscription_plans ORDER BY price ASC');
    res.json(result.rows);
});

// @route   POST /api/admin/plans
router.post('/plans', async (req, res) => {
    const { name, duration_hours, price, is_active } = req.body;
    const result = await query(
        'INSERT INTO subscription_plans (name, duration_hours, price, is_active) VALUES ($1, $2, $3, $4) RETURNING *',
        [name, duration_hours, price, is_active !== false]
    );
    res.json(result.rows[0]);
});

// @route   PUT /api/admin/plans/:id
router.put('/plans/:id', async (req, res) => {
    const { name, duration_hours, price, is_active } = req.body;
    await query(
        'UPDATE subscription_plans SET name=$1, duration_hours=$2, price=$3, is_active=$4 WHERE id=$5',
        [name, duration_hours, price, is_active, req.params.id]
    );
    res.json({ message: 'Plan updated' });
});

// @route   DELETE /api/admin/plans/:id
router.delete('/plans/:id', async (req, res) => {
    await query('DELETE FROM subscription_plans WHERE id = $1', [req.params.id]);
    res.json({ message: 'Plan deleted' });
});

// @route   PUT /api/admin/settings/ads
router.put('/settings/ads', async (req, res) => {
    const { ADSENSE_SCRIPT, ADS_TXT, ADS_ENABLED } = req.body;
    try {
        const settings = {
            'ADSENSE_SCRIPT': ADSENSE_SCRIPT,
            'ADS_TXT': ADS_TXT,
            'ADS_ENABLED': String(ADS_ENABLED)
        };
        for (const [key, value] of Object.entries(settings)) {
            await query('INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, String(value)]);
        }
        res.json({ message: 'Ads settings updated' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update ads settings' });
    }
});

// @route   PUT /api/admin/settings/payments
router.put('/settings/payments', async (req, res) => {
    const { provider, api_key, api_secret, is_active } = req.body;
    try {
        await query(
            'INSERT INTO payment_gateway_settings (provider, api_key, api_secret, is_active) VALUES ($1,$2,$3,$4) ON CONFLICT (provider) DO UPDATE SET api_key=$2, api_secret=$3, is_active=$4',
            [provider, api_key, api_secret, is_active]
        );
        res.json({ message: 'Payment settings updated' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update payment settings' });
    }
});

module.exports = router;
