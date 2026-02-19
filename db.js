const { Pool } = require('pg');
require('dotenv').config();
const bcrypt = require('bcryptjs');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.on('connect', () => {
    console.log('PostgreSQL Connected');
});

pool.on('error', (err) => {
    console.error('Database Error:', err);
    process.exit(1);
});

// Helper for running queries
// Helper for running queries
const query = async (text, params) => {
    try {
        return await pool.query(text, params);
    } catch (err) {
        console.error('Database Query Error:', err.message);
        throw err; // Re-throw to let the route handler deal with the specific response
    }
};

// Connection verification
const testConnection = async () => {
    let client;
    try {
        client = await pool.connect();
        const res = await client.query('SELECT NOW()');
        console.log('✅ PostgreSQL Connected Successfully at:', res.rows[0].now);
        return true;
    } catch (err) {
        console.error('❌ PostgreSQL Connection Failed:', err.message);
        return false;
    } finally {
        if (client) client.release();
    }
};

// Preload essential data
const preloadData = async () => {
    try {
        // 1. States Preload
        const stateCount = await query('SELECT COUNT(*) FROM states');
        if (parseInt(stateCount.rows[0].count) === 0) {
            const indianStates = [
                'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
                'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
                'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
                'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
                'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
                'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'
            ];
            for (const state of indianStates) {
                await query(`INSERT INTO states (name) VALUES ($1) ON CONFLICT (name) DO NOTHING;`, [state]);
            }
            console.log('✅ States Preloaded');
        }

        // 2. Languages Preload
        const langCount = await query('SELECT COUNT(*) FROM languages');
        if (parseInt(langCount.rows[0].count) === 0) {
            const officialLanguages = ['Hindi', 'English', 'Bengali', 'Marathi', 'Telugu', 'Tamil', 'Gujarati', 'Urdu', 'Kannada', 'Odia', 'Malayalam', 'Punjabi', 'Assamese', 'Maithili', 'Santhali', 'Kashmiri', 'Nepali', 'Sindhi', 'Konkani', 'Dogri', 'Manipuri', 'Sanskrit'];
            for (const lang of officialLanguages) {
                await query(`INSERT INTO languages (name) VALUES ($1) ON CONFLICT (name) DO NOTHING;`, [lang]);
            }
            console.log('✅ Languages Preloaded');
        }

        // 3. Categories Preload
        const catCount = await query('SELECT COUNT(*) FROM categories');
        if (parseInt(catCount.rows[0].count) === 0) {
            const cats = ['School', 'University', 'UPSC', 'CTET', 'SSC', 'Banking', 'Railway', 'State Govt Exams', 'Others'];
            for (let i = 0; i < cats.length; i++) {
                await query(`INSERT INTO categories (name, sort_order) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING;`, [cats[i], i]);
            }
            console.log('✅ Categories Preloaded');
        }

    } catch (err) {
        console.error('❌ Error preloading data:', err);
    }
};

// Auto-create tables logic
const initDB = async () => {
    try {
        console.log('Initializing/Verifying Database Tables...');

        // System Settings
        await query(`CREATE TABLE IF NOT EXISTS system_settings (key VARCHAR(50) PRIMARY KEY, value TEXT NOT NULL);`);
        const defaults = { 'FREE_DAILY_LIMIT': '2', 'FREE_LIMIT_WINDOW_HOURS': '24', 'GROUP_SIZE_LIMIT': '10', 'MCQ_PER_SESSION': '10' };
        for (const [key, value] of Object.entries(defaults)) {
            await query(`INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING;`, [key, value]);
        }

        // Users Table & Schema Sync
        await query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username VARCHAR(100) NOT NULL, email VARCHAR(100) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL, role VARCHAR(20) DEFAULT 'user', is_premium BOOLEAN DEFAULT FALSE, premium_expiry TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);

        // Ensure 'role' column exists (for cases where table already existed without it)
        try {
            await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user';`);
        } catch (e) {
            console.log('Note: role column already exists or migration skipped.');
        }

        // User Daily Usage
        await query(`CREATE TABLE IF NOT EXISTS user_daily_usage (user_id INTEGER REFERENCES users(id), date DATE DEFAULT CURRENT_DATE, count INTEGER DEFAULT 0, PRIMARY KEY (user_id, date));`);

        // Categories
        await query(`CREATE TABLE IF NOT EXISTS categories (id SERIAL PRIMARY KEY, name VARCHAR(100) UNIQUE NOT NULL, image_url TEXT, description TEXT, is_active BOOLEAN DEFAULT TRUE, sort_order INTEGER DEFAULT 0);`);

        // States & UT
        await query(`CREATE TABLE IF NOT EXISTS states (id SERIAL PRIMARY KEY, name VARCHAR(100) UNIQUE NOT NULL);`);

        // Languages
        await query(`CREATE TABLE IF NOT EXISTS languages (id SERIAL PRIMARY KEY, name VARCHAR(100) UNIQUE NOT NULL);`);

        // Hierarchy Tables
        await query(`CREATE TABLE IF NOT EXISTS boards (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, state_id INTEGER REFERENCES states(id), is_active BOOLEAN DEFAULT TRUE);`);
        await query(`CREATE TABLE IF NOT EXISTS classes (id SERIAL PRIMARY KEY, name VARCHAR(50) NOT NULL, is_active BOOLEAN DEFAULT TRUE);`);
        await query(`CREATE TABLE IF NOT EXISTS streams (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, is_active BOOLEAN DEFAULT TRUE);`);
        await query(`CREATE TABLE IF NOT EXISTS universities (id SERIAL PRIMARY KEY, name VARCHAR(200) NOT NULL, state_id INTEGER REFERENCES states(id), is_active BOOLEAN DEFAULT TRUE);`);
        await query(`CREATE TABLE IF NOT EXISTS semesters (id SERIAL PRIMARY KEY, name VARCHAR(50) NOT NULL, university_id INTEGER REFERENCES universities(id), is_active BOOLEAN DEFAULT TRUE);`);

        // Auto-create Classes
        const defaultClasses = ['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12'];
        for (const cls of defaultClasses) {
            await query(`INSERT INTO classes (name) SELECT $1::varchar WHERE NOT EXISTS (SELECT 1 FROM classes WHERE name = $1::varchar);`, [cls]);
        }

        // Auto-create Streams
        const defaultStreams = ['Science', 'Arts', 'Commerce'];
        for (const stm of defaultStreams) {
            await query(`INSERT INTO streams (name) SELECT $1::varchar WHERE NOT EXISTS (SELECT 1 FROM streams WHERE name = $1::varchar);`, [stm]);
        }

        await query(`CREATE TABLE IF NOT EXISTS subjects (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, board_id INTEGER REFERENCES boards(id), class_id INTEGER REFERENCES classes(id), stream_id INTEGER REFERENCES streams(id), semester_id INTEGER REFERENCES semesters(id), is_active BOOLEAN DEFAULT TRUE);`);
        await query(`CREATE TABLE IF NOT EXISTS chapters (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, subject_id INTEGER REFERENCES subjects(id), is_active BOOLEAN DEFAULT TRUE);`);

        // Other System Tables
        await query(`CREATE TABLE IF NOT EXISTS subscription_plans (id SERIAL PRIMARY KEY, name VARCHAR(50) NOT NULL, duration_hours INTEGER NOT NULL, price DECIMAL(10, 2) NOT NULL, is_active BOOLEAN DEFAULT TRUE);`);
        await query(`INSERT INTO subscription_plans (name, duration_hours, price) VALUES ('1 Hour Pass', 1, 10), ('3 Hour Pass', 3, 25) ON CONFLICT DO NOTHING;`);
        await query(`CREATE TABLE IF NOT EXISTS payments (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), razorpay_order_id VARCHAR(100), razorpay_payment_id VARCHAR(100), amount DECIMAL(10, 2), status VARCHAR(20), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
        await query(`CREATE TABLE IF NOT EXISTS referrals (id SERIAL PRIMARY KEY, referrer_id INTEGER REFERENCES users(id), referred_user_id INTEGER REFERENCES users(id), status VARCHAR(20) DEFAULT 'pending', reward_given BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
        await query(`CREATE TABLE IF NOT EXISTS ai_providers (id SERIAL PRIMARY KEY, name VARCHAR(100), base_url TEXT, api_key TEXT, model_name TEXT, is_active BOOLEAN DEFAULT TRUE);`);
        await query(`
            INSERT INTO ai_providers (name, base_url, api_key, model_name, is_active) 
            VALUES ($1, $2, $3, $4, $5) 
            ON CONFLICT DO NOTHING
        `, ['Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/models', process.env.GEMINI_API_KEY || '', 'gemini-1.5-flash', true]);
        await query(`CREATE TABLE IF NOT EXISTS ai_fetch_logs (id SERIAL PRIMARY KEY, fetch_type VARCHAR(100), reference_id INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
        await query(`CREATE TABLE IF NOT EXISTS ads_settings (id SERIAL PRIMARY KEY, location VARCHAR(50), script_content TEXT, is_active BOOLEAN DEFAULT TRUE);`);

        // NEW: Admin Dashboard Tables
        await query(`CREATE TABLE IF NOT EXISTS legal_pages (id SERIAL PRIMARY KEY, slug VARCHAR(50) UNIQUE NOT NULL, title VARCHAR(200) NOT NULL, content TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
        const legals = ['about-us', 'contact-us', 'privacy-policy', 'terms-conditions', 'refund-policy'];
        for (const slug of legals) {
            await query(`INSERT INTO legal_pages (slug, title, content) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING;`, [slug, slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '), 'Content coming soon...']);
        }

        await query(`CREATE TABLE IF NOT EXISTS payment_gateway_settings (id SERIAL PRIMARY KEY, provider VARCHAR(50) UNIQUE NOT NULL, api_key TEXT, api_secret TEXT, is_active BOOLEAN DEFAULT FALSE);`);
        await query(`INSERT INTO payment_gateway_settings (provider) VALUES ('razorpay'), ('stripe') ON CONFLICT (provider) DO NOTHING;`);

        await query(`CREATE TABLE IF NOT EXISTS revenue_logs (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), amount DECIMAL(10, 2), source VARCHAR(100), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);

        // Extend system_settings with SEO and Site Config
        const siteDefaults = {
            'SITE_TITLE': 'ExamRedy - AI MCQ Practice',
            'SITE_LOGO_URL': '',
            'HOME_BANNER_TEXT': 'Master Your Exams with AI-Powered MCQ Practice',
            'SUPPORT_EMAIL': 'support@examredy.in',
            'WHATSAPP_NUMBER': '',
            'GOOGLE_ANALYTICS_ID': '',
            'GOOGLE_SEARCH_CONSOLE_CODE': '',
            'FOOTER_CONTENT': '© 2026 ExamRedy. All rights reserved.',
            'META_TAGS': 'MCQ, Exam Practice, AI, Study'
        };
        for (const [key, value] of Object.entries(siteDefaults)) {
            await query(`INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING;`, [key, value]);
        }

        // MCQ Pool
        await query(`
            CREATE TABLE IF NOT EXISTS mcq_pool (
                id SERIAL PRIMARY KEY, 
                question TEXT NOT NULL, 
                options JSONB NOT NULL, 
                correct_option INTEGER NOT NULL, 
                explanation TEXT, 
                category_id INTEGER REFERENCES categories(id), 
                subject VARCHAR(100), 
                chapter VARCHAR(100), 
                difficulty VARCHAR(20) DEFAULT 'medium', 
                is_approved BOOLEAN DEFAULT FALSE, 
                question_hash VARCHAR(64),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_question_hash_unique ON mcq_pool(question_hash);`);

        // History & Groups
        await query(`CREATE TABLE IF NOT EXISTS user_mcq_history (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), mcq_id INTEGER REFERENCES mcq_pool(id), is_correct BOOLEAN, attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
        await query(`CREATE TABLE IF NOT EXISTS group_sessions (id VARCHAR(50) PRIMARY KEY, creator_id INTEGER REFERENCES users(id), is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
        await query(`CREATE TABLE IF NOT EXISTS group_participants (id SERIAL PRIMARY KEY, session_id VARCHAR(50) REFERENCES group_sessions(id), user_id INTEGER REFERENCES users(id), score INTEGER DEFAULT 0, joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);

        // Ensure Admin user exists
        const adminEmail = 'admin@examredy.in';
        const defaultAdminPass = 'Admin@123';
        const adminCheck = await query('SELECT * FROM users WHERE email = $1', [adminEmail]);

        console.log('Automating admin credentials...');
        const hashedDefaultPass = await bcrypt.hash(defaultAdminPass, 10);

        if (adminCheck.rows.length === 0) {
            console.log('Seeding default admin user...');
            await query(
                `INSERT INTO users (username, email, password, role) VALUES ($1, $2, $3, $4)`,
                ['admin', adminEmail, hashedDefaultPass, 'admin']
            );
            console.log('✅ Default Admin Created (admin@examredy.in / Admin@123)');
        } else {
            console.log('Ensuring admin security and credentials...');
            await query('UPDATE users SET password = $1, role = $2 WHERE email = $3', [hashedDefaultPass, 'admin', adminEmail]);
            console.log('✅ Admin credentials synchronized (Admin@123)');
        }

        if (!process.env.JWT_SECRET) {
            console.warn('⚠️ WARNING: JWT_SECRET is not defined in .env. Falling back to default.');
        }

        // PERFORMANCE INDEXES
        await query(`CREATE INDEX IF NOT EXISTS idx_boards_state ON boards(state_id);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_subjects_board ON subjects(board_id);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_subjects_class ON subjects(class_id);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_chapters_subject ON chapters(subject_id);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_univ_state ON universities(state_id);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_sem_univ ON semesters(university_id);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_mcq_cat ON mcq_pool(category_id);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_user_usage ON user_daily_usage(user_id);`);

        console.log('✅ All Database Tables Verified/Created & Indexes Applied');

        // Run Preload after DB init
        await preloadData();

    } catch (err) {
        console.error('❌ Error initializing database tables:', err);
    }
};

module.exports = { pool, query, initDB };
