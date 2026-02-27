const express = require('express');
const router = express.Router();
const { query, logBuffer, addToLog } = require('../db');
const { verifyToken, admin } = require('../middleware/authMiddleware');
const { hashPassword, comparePassword, generateToken } = require('../utils/helpers');

// --- DIAGNOSTICS & LOGIN ---

router.get('/diagnostic', async (req, res) => {
    try {
        addToLog('Diagnostic check triggered');
        const result = await query('SELECT id, username, email, role, (password IS NOT NULL) as has_password FROM users WHERE email = $1', ['admin@examredy.in']);
        res.json({ database: 'Connected', adminStatus: result.rows.length > 0 ? 'Found' : 'Not Found', adminDetails: result.rows[0] || null });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/logs', (req, res) => {
    res.json(logBuffer);
});

router.get('/fix-subjects', async (req, res) => {
    try {
        await query('UPDATE subjects SET category_id = (SELECT id FROM categories WHERE name ILIKE \'%school%\' LIMIT 1) WHERE board_id IS NOT NULL');
        await query('UPDATE subjects SET category_id = (SELECT id FROM categories WHERE name ILIKE \'%university%\' OR name ILIKE \'%college%\' LIMIT 1) WHERE university_id IS NOT NULL');
        res.json({ success: true, message: 'Subjects structure auto-healed.' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/debug-token', (req, res) => {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    res.json({ exists: !!authHeader, format_valid: authHeader ? authHeader.toLowerCase().startsWith('bearer ') : false, received_at: new Date().toISOString() });
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await query('SELECT id, username, email, password, role FROM users WHERE email = $1', [email]);
        const user = result.rows[0];
        if (!user || user.role !== 'admin') return res.status(403).json({ message: 'Not authorized' });
        const isMatch = await comparePassword(password, user.password);
        if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });
        const token = generateToken(user.id, user.role, user.email);
        res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// Protect all following routes
router.use(verifyToken, admin);

// --- 1. DASHBOARD ANALYTICS ---

router.get('/stats', async (req, res) => {
    try {
        const users = await query('SELECT COUNT(*) FROM users');
        const mcqs = await query('SELECT COUNT(*) FROM mcq_pool');
        const categories = await query('SELECT COUNT(*) FROM categories');
        const usersToday = await query('SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE');
        const revToday = await query('SELECT SUM(amount) FROM payments WHERE status = \'captured\' AND created_at >= CURRENT_DATE');
        const revMonthly = await query('SELECT SUM(amount) FROM payments WHERE status = \'captured\' AND created_at >= date_trunc(\'month\', CURRENT_DATE)');
        const revYearly = await query('SELECT SUM(amount) FROM payments WHERE status = \'captured\' AND created_at >= date_trunc(\'year\', CURRENT_DATE)');
        const revTotal = await query('SELECT SUM(amount) FROM payments WHERE status = \'captured\'');
        const activeUsers = await query('SELECT COUNT(DISTINCT user_id) FROM user_daily_usage WHERE date = CURRENT_DATE');

        res.json({
            activeUsers: parseInt(activeUsers.rows[0]?.count || 0),
            totalUsersToday: parseInt(usersToday.rows[0]?.count || 0),
            totalMCQs: parseInt(mcqs.rows[0]?.count || 0),
            totalCategories: parseInt(categories.rows[0]?.count || 0),
            revenueToday: parseFloat(revToday.rows[0]?.sum || 0),
            revenueMonthly: parseFloat(revMonthly.rows[0]?.sum || 0),
            revenueYearly: parseFloat(revYearly.rows[0]?.sum || 0),
            revenueTotal: parseFloat(revTotal.rows[0]?.sum || 0)
        });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

router.get('/stats/revenue', async (req, res) => {
    const daily = await query('SELECT date_trunc(\'day\', created_at) as date, SUM(amount) as amount FROM payments WHERE status = \'captured\' GROUP BY 1 ORDER BY 1 ASC LIMIT 30');
    res.json(daily.rows);
});

// --- 2. USER MANAGEMENT ---

router.get('/users', async (req, res) => {
    const { page = 1, limit = 20, search = '' } = req.query;
    const offset = (page - 1) * limit;
    let q = 'SELECT id, username, email, role, is_premium, is_active, created_at FROM users';
    const params = [limit, offset];
    if (search) { q += ' WHERE email ILIKE $3 OR username ILIKE $3'; params.push(`%${search}%`); }
    q += ' ORDER BY created_at DESC LIMIT $1 OFFSET $2';
    const result = await query(q, params);
    res.json(result.rows);
});

router.put('/users/:id/role', async (req, res) => {
    await query('UPDATE users SET role = $1 WHERE id = $2', [req.body.role, req.params.id]);
    res.json({ message: 'User role updated' });
});

router.put('/users/:id/subscription', async (req, res) => {
    const { action, hours, expiry, sessions } = req.body;
    if (expiry) {
        await query('UPDATE users SET premium_expiry = $1, is_premium = $2 WHERE id = $3', [expiry, new Date(expiry) > new Date(), req.params.id]);
    } else if (action === 'extend' || action === 'reduce') {
        const interval = `${hours || 24} hours`;
        const operator = action === 'extend' ? '+' : '-';
        await query(`UPDATE users SET premium_expiry = COALESCE(premium_expiry, CURRENT_TIMESTAMP) ${operator} $1::interval, is_premium = TRUE WHERE id = $2`, [interval, req.params.id]);
    } else if (action === 'sessions') {
        await query('UPDATE users SET sessions_left = sessions_left + $1, is_premium = TRUE WHERE id = $2', [parseInt(sessions) || 0, req.params.id]);
    } else if (action === 'cancel') {
        await query('UPDATE users SET is_premium = FALSE, premium_expiry = NULL WHERE id = $1', [req.params.id]);
    }
    res.json({ message: 'Subscription updated' });
});

router.post('/users/:id/reset-usage', async (req, res) => {
    await query('DELETE FROM user_daily_usage WHERE user_id = $1 AND date = CURRENT_DATE', [req.params.id]);
    res.json({ message: 'Usage reset' });
});

router.get('/users/:id/activity', async (req, res) => {
    try {
        const history = await query(`
            SELECT h.*, m.question, m.correct_option 
            FROM user_mcq_history h 
            JOIN mcq_pool m ON h.mcq_id = m.id 
            WHERE h.user_id = $1 
            ORDER BY h.attempted_at DESC 
            LIMIT 50
        `, [req.params.id]);

        const usage = await query('SELECT count FROM user_daily_usage WHERE user_id = $1 AND date = CURRENT_DATE', [req.params.id]);

        res.json({
            history: history.rows,
            todayCount: usage.rows[0]?.count || 0
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/users/:id/status', async (req, res) => {
    try {
        await query('UPDATE users SET is_active = $1 WHERE id = $2', [req.body.is_active, req.params.id]);
        const uRes = await query('SELECT id, username, email, role, is_premium, is_active, created_at FROM users ORDER BY created_at DESC LIMIT 20');
        res.json({ success: true, message: 'User status updated', updatedData: uRes.rows });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- 2.5 DASHBOARD OVERVIEW ---
router.get('/dashboard/stats', async (req, res) => {
    try {
        const totalUsers = await query('SELECT COUNT(*) FROM users');
        const premiumUsers = await query('SELECT COUNT(*) FROM users WHERE is_premium = true');
        const totalMcqs = await query('SELECT COUNT(*) FROM mcq_pool');
        const revenue = await query("SELECT SUM(amount) FROM payments WHERE status = 'success'");

        const recentActivity = await query(`
            SELECT u.username, u.email, du.count, du.date 
            FROM user_daily_usage du 
            JOIN users u ON du.user_id = u.id 
            ORDER BY du.date DESC LIMIT 10
        `);

        res.json({
            stats: {
                totalUsers: parseInt(totalUsers.rows[0].count),
                premiumUsers: parseInt(premiumUsers.rows[0].count),
                totalMcqs: parseInt(totalMcqs.rows[0].count),
                totalRevenue: parseFloat(revenue.rows[0].sum || 0)
            },
            recentActivity: recentActivity.rows
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});


// --- 3. CATEGORIES & STRUCTURE (STATES, LANGUAGES) ---

router.get('/categories', async (req, res) => {
    const result = await query('SELECT * FROM categories ORDER BY sort_order ASC');
    res.json(result.rows);
});
router.post('/categories', async (req, res) => {
    const { name, image_url, description, sort_order } = req.body;
    await query('INSERT INTO categories (name, image_url, description, sort_order) VALUES ($1,$2,$3,$4)', [name, image_url, description, sort_order]);
    res.json({ message: 'Category added' });
});
router.put('/categories/:id', async (req, res) => {
    const { name, image_url, description, sort_order, is_active } = req.body;
    await query('UPDATE categories SET name=$1, image_url=$2, description=$3, sort_order=$4, is_active=$5 WHERE id=$6', [name, image_url, description, sort_order, is_active, req.params.id]);
    res.json({ message: 'Category updated' });
});

router.get('/states', async (req, res) => {
    const result = await query('SELECT * FROM states ORDER BY name ASC');
    res.json(result.rows);
});
router.post('/states', async (req, res) => {
    try {
        const result = await query('INSERT INTO states (name, is_active) VALUES ($1, TRUE) RETURNING *', [req.body.name]);
        res.json({ success: true, state: result.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/states/:id', async (req, res) => {
    await query('UPDATE states SET name=$1, is_active=$2 WHERE id=$3', [req.body.name, req.body.is_active, req.params.id]);
    res.json({ message: 'State updated' });
});

router.get('/languages', async (req, res) => {
    const result = await query('SELECT * FROM languages ORDER BY name ASC');
    res.json(result.rows);
});
router.post('/languages', async (req, res) => {
    try {
        const result = await query('INSERT INTO languages (name, is_active) VALUES ($1, TRUE) RETURNING *', [req.body.name]);
        res.json({ success: true, language: result.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/languages/:id', async (req, res) => {
    await query('UPDATE languages SET name=$1, is_active=$2 WHERE id=$3', [req.body.name, req.body.is_active, req.params.id]);
    res.json({ message: 'Language updated' });
});

// --- 4. SCHOOL HIERARCHY ---

router.get('/boards', async (req, res) => {
    const result = await query('SELECT b.*, s.name as state_name FROM boards b LEFT JOIN states s ON b.state_id = s.id ORDER BY b.name ASC');
    res.json(result.rows);
});
router.post('/boards', async (req, res) => {
    try {
        await query('INSERT INTO boards (name, state_id, logo_url) VALUES ($1, $2, $3)', [req.body.name, req.body.state_id, req.body.logo_url]);
        const updated = await query('SELECT b.*, s.name as state_name FROM boards b LEFT JOIN states s ON b.state_id = s.id ORDER BY b.name ASC');
        res.json({ success: true, updatedData: updated.rows });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
router.put('/boards/:id', async (req, res) => {
    try {
        await query('UPDATE boards SET name=$1, state_id=$2, logo_url=$3, is_active=$4 WHERE id=$5', [req.body.name, req.body.state_id, req.body.logo_url, req.body.is_active, req.params.id]);
        const updated = await query('SELECT b.*, s.name as state_name FROM boards b LEFT JOIN states s ON b.state_id = s.id ORDER BY b.name ASC');
        res.json({ success: true, updatedData: updated.rows });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/classes/:board_id', verifyToken, admin, async (req, res) => {
    try {
        const result = await query(`
            SELECT bc.id, c.id as class_id, c.name, bc.is_active 
            FROM board_classes bc 
            JOIN classes c ON bc.class_id = c.id 
            WHERE bc.board_id = $1 ORDER BY c.id ASC
        `, [req.params.board_id]);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/classes', async (req, res) => {
    try {
        const { name, board_id } = req.body;
        // 1. Ensure class exists in classes table
        let classId;
        const existing = await query('SELECT id FROM classes WHERE LOWER(name) = LOWER($1)', [name]);
        if (existing.rows[0]) {
            classId = existing.rows[0].id;
        } else {
            const newClass = await query('INSERT INTO classes (name, is_active) VALUES ($1, TRUE) RETURNING id', [name]);
            classId = newClass.rows[0].id;
        }
        // 2. Link to board in board_classes
        if (board_id) {
            await query('INSERT INTO board_classes (board_id, class_id, is_active) VALUES ($1, $2, TRUE) ON CONFLICT (board_id, class_id) DO UPDATE SET is_active = TRUE', [board_id, classId]);
        }
        res.json({ success: true, message: 'Class added and linked to board', class_id: classId });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete ALL boards for a specific state (used for AI re-sync)
router.delete('/boards/state/:state_id', async (req, res) => {
    try {
        const result = await query('DELETE FROM boards WHERE state_id = $1 RETURNING id', [req.params.state_id]);
        res.json({ success: true, deleted: result.rowCount, message: `${result.rowCount} boards cleared for re-sync` });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Delete ALL universities for a specific state (used for AI re-sync)
router.delete('/universities/state/:state_id', async (req, res) => {
    try {
        const result = await query('DELETE FROM universities WHERE state_id = $1 RETURNING id', [req.params.state_id]);
        res.json({ success: true, deleted: result.rowCount });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/classes', async (req, res) => {
    const result = await query('SELECT * FROM classes ORDER BY id ASC');
    res.json(result.rows);
});

router.get('/streams', async (req, res) => {
    const result = await query('SELECT * FROM streams ORDER BY name ASC');
    res.json(result.rows);
});

// --- 5. UNIVERSITY & COMPETITIVE ---

router.get('/universities', async (req, res) => {
    const result = await query('SELECT u.*, s.name as state_name FROM universities u LEFT JOIN states s ON u.state_id = s.id ORDER BY u.name ASC');
    res.json(result.rows);
});
router.post('/universities', async (req, res) => {
    await query('INSERT INTO universities (name, state_id, logo_url) VALUES ($1, $2, $3)', [req.body.name, req.body.state_id, req.body.logo_url]);
    res.json({ message: 'University added' });
});
router.put('/universities/:id', async (req, res) => {
    const { name, state_id, logo_url, is_active } = req.body;
    await query('UPDATE universities SET name=$1, state_id=$2, logo_url=$3, is_active=$4 WHERE id=$5', [name, state_id, logo_url, is_active, req.params.id]);
    res.json({ message: 'University updated' });
});

router.get('/degree-types', async (req, res) => {
    const result = await query('SELECT * FROM degree_types ORDER BY name ASC');
    res.json(result.rows);
});
router.post('/degree-types', async (req, res) => {
    await query('INSERT INTO degree_types (name) VALUES ($1)', [req.body.name]);
    res.json({ message: 'Course/Degree Type added' });
});
router.put('/degree-types/:id', async (req, res) => {
    await query('UPDATE degree_types SET name=$1, is_active=$2 WHERE id=$3', [req.body.name, req.body.is_active, req.params.id]);
    res.json({ message: 'Course/Degree Type updated' });
});

router.get('/semesters', async (req, res) => {
    const result = await query('SELECT * FROM semesters ORDER BY id ASC');
    res.json(result.rows);
});

router.get('/papers-stages', async (req, res) => {
    const result = await query('SELECT p.*, c.name as category_name FROM papers_stages p LEFT JOIN categories c ON p.category_id = c.id ORDER BY p.name ASC');
    res.json(result.rows);
});
router.post('/papers-stages', async (req, res) => {
    await query('INSERT INTO papers_stages (name, category_id) VALUES ($1, $2)', [req.body.name, req.body.category_id]);
    res.json({ message: 'Paper/Stage added' });
});
router.put('/papers-stages/:id', async (req, res) => {
    await query('UPDATE papers_stages SET name=$1, category_id=$2, is_active=$3 WHERE id=$4', [req.body.name, req.body.category_id, req.body.is_active, req.params.id]);
    res.json({ message: 'Paper/Stage updated' });
});

// --- 6. SUBJECTS & CHAPTERS ---

router.get('/subjects', async (req, res) => {
    const result = await query(`
        SELECT sub.*, b.name as board_name, c.name as class_name, str.name as stream_name, cat.name as category_name 
        FROM subjects sub 
        LEFT JOIN boards b ON sub.board_id = b.id 
        LEFT JOIN classes c ON sub.class_id = c.id 
        LEFT JOIN streams str ON sub.stream_id = str.id
        LEFT JOIN categories cat ON sub.category_id = cat.id
        ORDER BY sub.name ASC
    `);
    res.json(result.rows);
});
router.post('/subjects', async (req, res) => {
    try {
        const { name, category_id, board_id, university_id, class_id, stream_id, semester_id, degree_type_id, paper_stage_id } = req.body;
        await query('INSERT INTO subjects (name, category_id, board_id, university_id, class_id, stream_id, semester_id, degree_type_id, paper_stage_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [name, category_id, board_id, university_id, class_id, stream_id, semester_id, degree_type_id, paper_stage_id]);
        const updated = await query(`SELECT sub.*, b.name as board_name, c.name as class_name, str.name as stream_name, cat.name as category_name FROM subjects sub LEFT JOIN boards b ON sub.board_id = b.id LEFT JOIN classes c ON sub.class_id = c.id LEFT JOIN streams str ON sub.stream_id = str.id LEFT JOIN categories cat ON sub.category_id = cat.id ORDER BY sub.name ASC`);
        res.json({ success: true, updatedData: updated.rows });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
router.put('/subjects/:id', async (req, res) => {
    try {
        const { name, category_id, board_id, university_id, class_id, stream_id, semester_id, degree_type_id, paper_stage_id, is_active } = req.body;
        await query(`UPDATE subjects SET name=$1, category_id=$2, board_id=$3, university_id=$4, class_id=$5, stream_id=$6, semester_id=$7, degree_type_id=$8, paper_stage_id=$9, is_active=$10 WHERE id=$11`,
            [name, category_id, board_id, university_id, class_id, stream_id, semester_id, degree_type_id, paper_stage_id, is_active, req.params.id]);
        const updated = await query(`SELECT sub.*, b.name as board_name, c.name as class_name, str.name as stream_name, cat.name as category_name FROM subjects sub LEFT JOIN boards b ON sub.board_id = b.id LEFT JOIN classes c ON sub.class_id = c.id LEFT JOIN streams str ON sub.stream_id = str.id LEFT JOIN categories cat ON sub.category_id = cat.id ORDER BY sub.name ASC`);
        res.json({ success: true, updatedData: updated.rows });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/chapters', async (req, res) => {
    try {
        const result = await query('SELECT ch.*, sub.name as subject_name FROM chapters ch LEFT JOIN subjects sub ON ch.subject_id = sub.id ORDER BY ch.name ASC');
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/chapters', async (req, res) => {
    try {
        await query('INSERT INTO chapters (name, subject_id, description, sort_order) VALUES ($1, $2, $3, $4)', [req.body.name, req.body.subject_id, req.body.description, req.body.sort_order]);
        const updated = await query('SELECT ch.*, sub.name as subject_name FROM chapters ch LEFT JOIN subjects sub ON ch.subject_id = sub.id ORDER BY ch.name ASC');
        res.json({ success: true, updatedData: updated.rows });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
router.put('/chapters/:id', async (req, res) => {
    try {
        const { name, subject_id, description, sort_order, is_active } = req.body;
        await query('UPDATE chapters SET name=$1, subject_id=$2, description=$3, sort_order=$4, is_active=$5 WHERE id=$6', [name, subject_id, description, sort_order, is_active, req.params.id]);
        const updated = await query('SELECT ch.*, sub.name as subject_name FROM chapters ch LEFT JOIN subjects sub ON ch.subject_id = sub.id ORDER BY ch.name ASC');
        res.json({ success: true, updatedData: updated.rows });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- 7. MCQ MANAGEMENT ---

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

// --- 0. BULK APPROVAL SYSTEM ---
router.put('/bulk-approve', async (req, res) => {
    try {
        const { type, ids } = req.body;
        if (!type || !ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'Invalid payload' });
        }

        // Strict mapping of valid table types to prevent SQL injection
        const tableMap = {
            'categories': 'categories',
            'states': 'states',
            'boards': 'boards',
            'classes': 'board_classes',
            'streams': 'streams',
            'universities': 'universities',
            'degree_types': 'degree_types',
            'semesters': 'semesters',
            'papers_stages': 'papers_stages',
            'subjects': 'subjects',
            'chapters': 'chapters'
        };

        const tableName = tableMap[type];
        if (!tableName) return res.status(400).json({ success: false, message: 'Invalid structure type' });

        const result = await query(`UPDATE ${tableName} SET is_active = TRUE WHERE id = ANY($1::int[]) RETURNING id`, [ids]);
        res.json({ success: true, message: `${result.rowCount} items approved successfully` });
    } catch (e) {
        console.error('Bulk Approve Error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// --- 1. DASHBOARD & ANALYTICS ---

router.get('/stats', async (req, res) => {
    try {
        const users = await query('SELECT COUNT(*) FROM users');
        const mcqs = await query('SELECT COUNT(*) FROM mcq_pool');
        const activeSessions = await query("SELECT COUNT(*) FROM group_sessions WHERE is_active = TRUE");
        res.json({
            users: users.rows[0].count,
            mcqs: mcqs.rows[0].count,
            sessions: activeSessions.rows[0].count
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/analytics/revenue', async (req, res) => {
    try {
        const total = await query("SELECT SUM(amount) FROM payments WHERE status IN ('captured', 'success')");
        const today = await query("SELECT SUM(amount) FROM payments WHERE status IN ('captured', 'success') AND created_at >= CURRENT_DATE");
        const month = await query("SELECT SUM(amount) FROM payments WHERE status IN ('captured', 'success') AND created_at >= date_trunc('month', CURRENT_DATE)");
        const year = await query("SELECT SUM(amount) FROM payments WHERE status IN ('captured', 'success') AND created_at >= date_trunc('year', CURRENT_DATE)");

        const chartData = await query(`
            SELECT date_trunc('day', created_at) as date, SUM(amount) as amount 
            FROM payments 
            WHERE status IN ('captured', 'success') AND created_at >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY 1 ORDER BY 1 ASC
        `);

        res.json({
            total: parseFloat(total.rows[0].sum || 0),
            today: parseFloat(today.rows[0].sum || 0),
            thisMonth: parseFloat(month.rows[0].sum || 0),
            thisYear: parseFloat(year.rows[0].sum || 0),
            chartData: chartData.rows
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/analytics/subscriptions', async (req, res) => {
    try {
        const active = await query("SELECT COUNT(*) FROM users WHERE is_premium = TRUE AND premium_expiry > NOW()");
        const total = await query("SELECT COUNT(*) FROM users WHERE role = 'user'");
        res.json({
            activePremium: parseInt(active.rows[0].count),
            totalUsers: parseInt(total.rows[0].count)
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// MCQ Approve
router.get('/mcqs/stats', async (req, res) => {
    try {
        const total = await query('SELECT COUNT(*) FROM mcq_pool');
        const pending = await query('SELECT COUNT(*) FROM mcq_pool WHERE is_approved = FALSE');
        const approved = await query('SELECT COUNT(*) FROM mcq_pool WHERE is_approved = TRUE');
        res.json({
            total: parseInt(total.rows[0].count),
            pending: parseInt(pending.rows[0].count),
            approved: parseInt(approved.rows[0].count)
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/mcqs/:id/approve', async (req, res) => {
    try {
        await query('UPDATE mcq_pool SET is_approved = TRUE WHERE id = $1', [req.params.id]);
        res.json({ message: 'MCQ approved' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/mcqs/:id', async (req, res) => {
    try {
        const { question, options, correct_option, explanation, category_id, subject, chapter, difficulty } = req.body;
        await query(
            'UPDATE mcq_pool SET question=$1, options=$2, correct_option=$3, explanation=$4, category_id=$5, subject=$6, chapter=$7, difficulty=$8 WHERE id=$9',
            [question, JSON.stringify(options), correct_option, explanation, category_id, subject, chapter, difficulty, req.params.id]
        );
        res.json({ success: true, message: 'MCQ updated' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/mcqs/bulk', async (req, res) => {
    try {
        const { mcqs } = req.body;
        const crypto = require('crypto');
        let count = 0;
        for (const m of mcqs) {
            const hash = crypto.createHash('sha256').update(m.question.trim().toLowerCase()).digest('hex');
            const result = await query(
                `INSERT INTO mcq_pool (question, options, correct_option, explanation, category_id, subject, chapter, difficulty, is_approved, question_hash)
                 SELECT $1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9
                 WHERE NOT EXISTS (SELECT 1 FROM mcq_pool WHERE question_hash = $9)
                 RETURNING id`,
                [m.question, JSON.stringify(m.options), m.correct_option, m.explanation, m.category_id, m.subject, m.chapter, m.difficulty || 'medium', hash]
            );
            if (result.rows[0]) count++;
        }
        res.json({ success: true, message: `${count} MCQs uploaded successfully` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// MCQ Delete
router.delete('/mcqs/:id', async (req, res) => {
    try {
        await query('DELETE FROM mcq_pool WHERE id = $1', [req.params.id]);
        res.json({ message: 'MCQ deleted' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Generic toggle for approval (Requirement 2 & 3)
router.put('/approve/:table/:id', async (req, res) => {
    const { table, id } = req.params;
    const allowedTables = ['boards', 'universities', 'subjects', 'chapters', 'papers_stages', 'degree_types', 'semesters'];
    if (!allowedTables.includes(table)) return res.status(400).json({ message: 'Invalid table' });

    await query(`UPDATE ${table} SET is_approved = $1 WHERE id = $2`, [req.body.is_approved, id]);
    res.json({ message: `${table} item ${req.body.is_approved ? 'approved' : 'unapproved'}` });
});

router.delete('/:table/:id', async (req, res) => {
    const { table, id } = req.params;
    const allowedTables = ['boards', 'universities', 'subjects', 'chapters', 'papers_stages', 'degree_types', 'semesters'];
    const tableMap = {
        'streams': 'streams',
        'languages': 'languages',
        'states': 'states',
        'categories': 'categories',
        'ai-providers': 'ai_providers'
    };
    const actualTable = tableMap[table] || table;
    if (!allowedTables.includes(table) && !tableMap[table]) return res.status(400).json({ message: 'Invalid table' });

    try {
        await query(`DELETE FROM ${actualTable} WHERE id = $1`, [id]);
        res.json({ message: 'Item deleted' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- 8. AI MANAGEMENT ---

router.post('/ai-providers/fetch-models', async (req, res) => {
    const { base_url, api_key } = req.body;
    if (!base_url) return res.status(400).json({ error: 'base_url is required', models: [] });
    const axios = require('axios');
    let cleanUrl = base_url.replace(/\/$/, '');
    if (cleanUrl.endsWith('/models')) {
        cleanUrl = cleanUrl.slice(0, -7);
    }

    try {
        // Try OpenAI-compatible /models endpoint (OpenAI, OpenRouter, Groq, Together, etc.)
        const response = await axios.get(`${cleanUrl}/models`, {
            headers: { 'Authorization': `Bearer ${api_key}`, 'HTTP-Referer': 'https://examredy.in' },
            timeout: 12000
        });
        let models = [];
        if (response.data?.data && Array.isArray(response.data.data)) {
            models = response.data.data.map(m => m.id).filter(Boolean).sort();
        } else if (response.data?.models && Array.isArray(response.data.models)) {
            models = response.data.models.map(m => (m.name || m.id || '').replace('models/', '')).filter(Boolean).sort();
        }
        return res.json({ success: true, models });
    } catch (err) {
        // Fallback: Gemini-style with api_key as query param
        try {
            const geminiRes = await axios.get(`${cleanUrl}/models?key=${api_key}`, { timeout: 10000 });
            const models = (geminiRes.data?.models || [])
                .map(m => (m.name || '').replace('models/', ''))
                .filter(m => m && !m.includes('embedding') && !m.includes('aqa'))
                .sort();
            return res.json({ success: true, models });
        } catch (e) {
            return res.status(400).json({ error: `Cannot reach provider: ${err.message}`, models: [] });
        }
    }
});

router.get('/ai-providers', async (req, res) => {
    const result = await query('SELECT * FROM ai_providers ORDER BY id ASC');
    res.json(result.rows);
});

router.post('/ai-providers', async (req, res) => {
    try {
        const { name, base_url, api_key, model_name } = req.body;
        const result = await query(
            'INSERT INTO ai_providers (name, base_url, api_key, model_name, is_active) VALUES ($1, $2, $3, $4, FALSE) RETURNING *',
            [name, base_url || '', api_key || '', model_name || '']
        );
        res.json({ message: 'AI Provider added', provider: result.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/ai-providers/:id', async (req, res) => {
    try {
        const { name, base_url, api_key, model_name, is_active } = req.body;
        await query('UPDATE ai_providers SET name=$1, base_url=$2, api_key=$3, model_name=$4, is_active=$5 WHERE id=$6', [name, base_url, api_key, model_name, is_active, req.params.id]);
        res.json({ message: 'AI Provider configuration updated' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/ai-providers/:id/status', async (req, res) => {
    try {
        const { is_active } = req.body;
        if (is_active) await query('UPDATE ai_providers SET is_active = FALSE');
        await query('UPDATE ai_providers SET is_active = $1 WHERE id = $2', [is_active, req.params.id]);
        res.json({ message: 'AI Provider status toggled' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/ai-providers/:id', async (req, res) => {
    try {
        await query('DELETE FROM ai_providers WHERE id = $1', [req.params.id]);
        res.json({ message: 'AI Provider deleted' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- 9. SUBSCRIPTIONS & REFERRALS ---

router.get('/plans', async (req, res) => {
    try {
        const result = await query('SELECT * FROM subscription_plans ORDER BY price ASC');
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/plans', async (req, res) => {
    try {
        const { name, price, is_active, sessions_limit, referral_bonus_sessions } = req.body;
        const result = await query(
            'INSERT INTO subscription_plans (name, duration_hours, price, is_active, sessions_limit, referral_bonus_sessions) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [name, 1, price, is_active !== undefined ? is_active : true, parseInt(sessions_limit) || 0, parseInt(referral_bonus_sessions) || 0]
        );
        res.status(201).json(result.rows[0]);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.put('/plans/:id', async (req, res) => {
    try {
        const { name, price, is_active, sessions_limit, referral_bonus_sessions } = req.body;
        console.log(`[ADMIN-PLANS] Updating plan ${req.params.id}:`, { name, price, is_active, sessions_limit, referral_bonus_sessions });

        const result = await query(
            'UPDATE subscription_plans SET name=$1, price=$2, is_active=$3, sessions_limit=$4, referral_bonus_sessions=$5 WHERE id=$6 RETURNING *',
            [name, parseFloat(price) || 0, is_active === true, parseInt(sessions_limit) || 0, parseInt(referral_bonus_sessions) || 0, parseInt(req.params.id)]
        );

        if (result.rowCount === 0) {
            console.warn(`[ADMIN-PLANS] No plan found with ID ${req.params.id}`);
            return res.status(404).json({ success: false, error: 'Plan not found or no changes made' });
        }

        console.log(`[ADMIN-PLANS] Success: Plan ${req.params.id} updated.`);
        res.json({ success: true, message: 'Plan updated successfully' });
    } catch (e) {
        console.error('[ADMIN-PLANS] Update failed:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.put('/plans/:id/status', async (req, res) => {
    try {
        await query('UPDATE subscription_plans SET is_active = $1 WHERE id = $2', [req.body.is_active, req.params.id]);
        res.json({ message: 'Plan status updated' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/referrals', async (req, res) => {
    const result = await query(`
        SELECT r.*, u1.email as referrer_email, u2.email as referred_email 
        FROM referrals r 
        LEFT JOIN users u1 ON r.referrer_id = u1.id 
        LEFT JOIN users u2 ON r.referred_user_id = u2.id 
        ORDER BY r.created_at DESC
    `);
    res.json(result.rows);
});

router.put('/referrals/:id/reward', async (req, res) => {
    const { status, reward_given } = req.body;
    await query('UPDATE referrals SET status = $1, reward_given = $2 WHERE id = $3', [status, reward_given, req.params.id]);
    res.json({ message: 'Referral reward adjusted' });
});

// --- 10. TRANSACTIONS & PERFORMANCE ---

router.get('/payments/transactions', async (req, res) => {
    const result = await query(`
        SELECT p.*, u.email as user_email 
        FROM payments p 
        LEFT JOIN users u ON p.user_id = u.id 
        ORDER BY p.created_at DESC 
        LIMIT 100
    `);
    res.json(result.rows);
});

// --- 11. SYSTEM SETTINGS (ADS, PAYMENTS, LEGAL, GLOBAL, FREE LIMIT) ---

router.get('/settings', async (req, res) => {
    const sys = await query('SELECT * FROM system_settings');
    const legal = await query('SELECT * FROM legal_pages');
    const pay = await query('SELECT * FROM payment_gateway_settings');
    const free = await query('SELECT * FROM free_limit_settings');
    res.json({
        system: Object.fromEntries(sys.rows.map(r => [r.key, r.value])),
        legal: legal.rows,
        payment: pay.rows,
        freeLimit: Object.fromEntries(free.rows.map(r => [r.key, r.value]))
    });
});

router.put('/settings/global', async (req, res) => {
    for (const [key, value] of Object.entries(req.body.settings)) {
        await query('INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, String(value)]);
    }
    res.json({ message: 'Settings updated' });
});

router.put('/settings/free-limit', async (req, res) => {
    for (const [key, value] of Object.entries(req.body.settings)) {
        await query('INSERT INTO free_limit_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, String(value)]);
    }
    res.json({ message: 'Free limit control updated' });
});

router.put('/settings/legal/:id', async (req, res) => {
    await query('UPDATE legal_pages SET content=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2', [req.body.content, req.params.id]);
    res.json({ message: 'Legal page updated' });
});

router.put('/settings/ads', async (req, res) => {
    try {
        const keys = {
            'ADS_HEADER_SCRIPT': req.body.ADS_HEADER_SCRIPT,
            'ADS_BODY_SCRIPT': req.body.ADS_BODY_SCRIPT,
            'ADS_TXT': req.body.ADS_TXT,
            'ADS_ENABLED': String(req.body.ADS_ENABLED),
            'ADS_TOP_BANNER': req.body.ADS_TOP_BANNER,
            'ADS_MID_CONTENT': req.body.ADS_MID_CONTENT,
            'ADS_BOTTOM_BANNER': req.body.ADS_BOTTOM_BANNER,
            'ADS_FOR_PREMIUM': String(req.body.ADS_FOR_PREMIUM)
        };
        for (const [key, value] of Object.entries(keys)) {
            if (value !== undefined) {
                await query('INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, String(value)]);
            }
        }
        res.json({ success: true, message: 'Ad configuration updated' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- 11.5 ADS SETTINGS ---
router.get('/ads', async (req, res) => {
    try {
        const result = await query('SELECT * FROM ads_settings ORDER BY platform DESC, ad_type ASC');
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/ads', async (req, res) => {
    try {
        const { platform, ad_type, ad_unit_id, is_active } = req.body;
        // Upsert logic: Update if exists, otherwise insert
        await query(`
            INSERT INTO ads_settings (platform, ad_type, ad_unit_id, is_active, updated_at) 
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
            ON CONFLICT (platform, ad_type) 
            DO UPDATE SET ad_unit_id = EXCLUDED.ad_unit_id, is_active = EXCLUDED.is_active, updated_at = CURRENT_TIMESTAMP
        `, [platform, ad_type, ad_unit_id, is_active !== undefined ? is_active : true]);

        res.json({ success: true, message: 'Ad configuration updated' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/ads/:id/status', async (req, res) => {
    try {
        const { is_active } = req.body;
        await query('UPDATE ads_settings SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [is_active, req.params.id]);
        res.json({ success: true, message: 'Ad status toggled' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/settings/seo', async (req, res) => {
    const { GA_ID, SEARCH_CONSOLE_CODE, META_TITLE, META_DESC, KEYWORDS } = req.body;
    const seo = {
        'GOOGLE_ANALYTICS_ID': GA_ID,
        'GOOGLE_SEARCH_CONSOLE_CODE': SEARCH_CONSOLE_CODE,
        'META_TITLE': META_TITLE,
        'META_DESC': META_DESC,
        'META_KEYWORDS': KEYWORDS
    };
    for (const [key, value] of Object.entries(seo)) {
        await query('INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, String(value)]);
    }
    res.json({ message: 'SEO settings updated' });
});

router.put('/settings/referral', async (req, res) => {
    try {
        const { REFERRAL_ENABLED, REFERRAL_REWARD_TYPE, REFERRAL_REWARD_DURATION, REFERRAL_MIN_PURCHASE_RS } = req.body;
        const keys = {
            'REFERRAL_ENABLED': String(REFERRAL_ENABLED), // 'true' or 'false'
            'REFERRAL_REWARD_TYPE': REFERRAL_REWARD_TYPE, // 'hours' or 'days'
            'REFERRAL_REWARD_DURATION': REFERRAL_REWARD_DURATION,
            'REFERRAL_MIN_PURCHASE_RS': REFERRAL_MIN_PURCHASE_RS,
            // Keep backwards compatibility
            'REFERRAL_REWARD_DAYS': REFERRAL_REWARD_TYPE === 'days' ? REFERRAL_REWARD_DURATION : undefined
        };
        for (const [key, value] of Object.entries(keys)) {
            if (value !== undefined && value !== 'undefined') {
                await query('INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, String(value)]);
            }
        }
        res.json({ success: true, message: 'Referral rules updated' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/referrals/:id/grant', async (req, res) => {
    try {
        const { id } = req.params;
        const refCheck = await query('SELECT * FROM referrals WHERE id = $1', [id]);
        if (refCheck.rows.length === 0) return res.status(404).json({ error: 'Referral not found' });
        const ref = refCheck.rows[0];

        if (ref.reward_given) return res.status(400).json({ error: 'Reward already granted' });

        const sys = await query('SELECT key, value FROM system_settings WHERE key IN ($1, $2)', ['REFERRAL_REWARD_TYPE', 'REFERRAL_REWARD_DURATION']);
        const settings = Object.fromEntries(sys.rows.map(r => [r.key, r.value]));

        const type = settings.REFERRAL_REWARD_TYPE || 'days';
        const duration = parseInt(settings.REFERRAL_REWARD_DURATION || 2);

        const intervalStr = type === 'hours' ? `${duration} hours` : `${duration} days`;

        // Grant to referrer
        await query(`UPDATE users SET is_premium = true, premium_expiry = GREATEST(COALESCE(premium_expiry, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP) + INTERVAL '${intervalStr}' WHERE id = $1`, [ref.referrer_id]);

        // Grant to referred
        await query(`UPDATE users SET is_premium = true, premium_expiry = GREATEST(COALESCE(premium_expiry, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP) + INTERVAL '${intervalStr}' WHERE id = $1`, [ref.referred_user_id]);

        // Mark complete
        await query(`UPDATE referrals SET status = 'completed', reward_given = TRUE WHERE id = $1`, [id]);

        res.json({ success: true, message: `Reward of ${duration} ${type} granted to both users manually.` });
    } catch (e) {
        console.error('Manual Grant Error:', e);
        res.status(500).json({ error: e.message });
    }
});

router.put('/settings/payments/:provider', async (req, res) => {
    const { provider } = req.params;
    const { api_key, api_secret, is_active } = req.body;

    // If updating keys
    if (api_key !== undefined) {
        await query('UPDATE payment_gateway_settings SET api_key=$1, api_secret=$2 WHERE provider=$3', [api_key, api_secret, provider]);
    }

    // If toggling status
    if (is_active !== undefined) {
        await query('UPDATE payment_gateway_settings SET is_active=$1 WHERE provider=$2', [is_active, provider]);
    }

    res.json({ message: 'Payment gateway settings updated' });
});

// --- 12. AI FETCH ENHANCEMENTS (SCHOOL CENTRAL) ---

router.post('/ai-fetch/boards', async (req, res) => {
    const { state_id, state_name } = req.body;
    try {
        const { generateSchoolBoards } = require('../services/aiService');
        const boards = await generateSchoolBoards(state_name);
        const savedBoards = [];
        for (const board of boards) {
            const result = await query(
                `INSERT INTO boards (name, state_id, is_approved)
                 SELECT $1, $2, TRUE
                 WHERE NOT EXISTS (SELECT 1 FROM boards WHERE state_id=$2 AND LOWER(name)=LOWER($1))
                 RETURNING *`,
                [board.name, state_id]
            );
            if (result.rows[0]) savedBoards.push(result.rows[0]);
        }
        await query("INSERT INTO ai_fetch_logs (type, context, status) VALUES ('boards', $1, 'success')", [`State: ${state_name}`]);
        const updated = await query('SELECT b.*, s.name as state_name FROM boards b LEFT JOIN states s ON b.state_id = s.id ORDER BY b.name ASC');
        res.json({ success: true, count: savedBoards.length, updatedData: updated.rows });
    } catch (e) {
        try { await query("INSERT INTO ai_fetch_logs (type, context, status, error_message) VALUES ('boards', $1, 'error', $2)", [`State: ${state_name}`, e.message]); } catch (_) { }
        console.error('AI Board Fetch Error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/ai-fetch/subjects', async (req, res) => {
    const { board_id, class_id, board_name, class_name, stream_id, stream_name } = req.body;
    try {
        const { generateSchoolSubjects } = require('../services/aiService');
        const subjects = await generateSchoolSubjects(board_name, class_name, stream_name);
        const savedSubjects = [];
        for (const sub of subjects) {
            const result = await query(
                `INSERT INTO subjects (name, category_id, board_id, class_id, stream_id, is_approved, is_active)
                 SELECT $1, 1, $2, $3, $4, TRUE, TRUE
                 WHERE NOT EXISTS (SELECT 1 FROM subjects WHERE board_id=$2 AND class_id=$3 AND LOWER(name)=LOWER($1))
                 RETURNING *`,
                [sub.name, board_id, class_id, stream_id]
            );
            if (result.rows[0]) savedSubjects.push(result.rows[0]);
        }
        await query("INSERT INTO ai_fetch_logs (type, context, status) VALUES ('subjects', $1, 'success')", [`Board: ${board_name}, Class: ${class_name}`]);
        const updated = await query(`SELECT sub.*, b.name as board_name, c.name as class_name, str.name as stream_name, cat.name as category_name FROM subjects sub LEFT JOIN boards b ON sub.board_id = b.id LEFT JOIN classes c ON sub.class_id = c.id LEFT JOIN streams str ON sub.stream_id = str.id LEFT JOIN categories cat ON sub.category_id = cat.id ORDER BY sub.name ASC`);
        res.json({ success: true, count: savedSubjects.length, updatedData: updated.rows });
    } catch (e) {
        try { await query("INSERT INTO ai_fetch_logs (type, context, status, error_message) VALUES ('subjects', $1, 'error', $2)", [`Board: ${board_name}, Class: ${class_name}`, e.message]); } catch (_) { }
        console.error('AI Subject Fetch Error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/ai-fetch/chapters', async (req, res) => {
    const { subject_id, subject_name, board_name, class_name } = req.body;
    try {
        const { generateSchoolChapters } = require('../services/aiService');
        const chapters = await generateSchoolChapters(subject_name, board_name, class_name);
        const savedChapters = [];
        for (const chap of chapters) {
            const result = await query(
                `INSERT INTO chapters (name, subject_id, is_active)
                 SELECT $1, $2, TRUE
                 WHERE NOT EXISTS (SELECT 1 FROM chapters WHERE subject_id=$2 AND LOWER(name)=LOWER($1))
                 RETURNING *`,
                [chap.name, subject_id]
            );
            if (result.rows[0]) savedChapters.push(result.rows[0]);
        }
        await query("INSERT INTO ai_fetch_logs (type, context, status) VALUES ('chapters', $1, 'success')", [`Subject: ${subject_name}, Class: ${class_name}`]);
        const updated = await query('SELECT ch.*, sub.name as subject_name FROM chapters ch LEFT JOIN subjects sub ON ch.subject_id = sub.id ORDER BY ch.name ASC');
        res.json({ success: true, count: savedChapters.length, updatedData: updated.rows });
    } catch (e) {
        try { await query("INSERT INTO ai_fetch_logs (type, context, status, error_message) VALUES ('chapters', $1, 'error', $2)", [`Subject: ${subject_name}, Class: ${class_name}`, e.message]); } catch (_) { }
        console.error('AI Chapter Fetch Error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// --- 13. LEGAL PAGES MANAGEMENT ---
router.get('/legal-pages', async (req, res) => {
    try {
        const result = await query('SELECT * FROM legal_pages ORDER BY id ASC');
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/legal-pages/:id', async (req, res) => {
    const { title, content, is_active } = req.body;
    const { id } = req.params;

    console.log(`[LEGAL-UPDATE] Attempting to update page ID: ${id}`, { title, is_active });

    if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({ error: 'Invalid page ID' });
    }

    try {
        const result = await query(
            'UPDATE legal_pages SET title = $1, content = $2, is_active = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
            [title, content, is_active, parseInt(id)]
        );

        console.log(`[LEGAL-UPDATE] Update result for ID ${id}:`, result.rowCount, 'rows affected');

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Page not found in database' });
        }

        res.json({ success: true, message: 'Legal page updated' });
    } catch (e) {
        console.error(`[LEGAL-UPDATE-ERROR] ID ${id}:`, e.message);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
