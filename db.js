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
        } else {
            // Ensure specific categories exist as per spec
            const requiredCats = ['UPSC', 'CTET', 'SSC', 'Banking', 'Railway', 'State Govt Exams', 'Others'];
            for (const cat of requiredCats) {
                await query(`INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING;`, [cat]);
            }
        }

        // 4. Classes Preload (Requirement 3)
        const classCount = await query('SELECT COUNT(*) FROM classes');
        if (parseInt(classCount.rows[0].count) === 0) {
            const defaultClasses = [
                'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5',
                'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10',
                'Class 11', 'Class 12'
            ];
            for (const c of defaultClasses) {
                await query(`INSERT INTO classes (name) VALUES ($1) ON CONFLICT (name) DO NOTHING;`, [c]);
            }
            console.log('✅ Classes Preloaded');
        }

        // 5. Streams Preload (Requirement 3)
        const streamCount = await query('SELECT COUNT(*) FROM streams');
        if (parseInt(streamCount.rows[0].count) === 0) {
            const defaultStreams = ['Science', 'Commerce', 'Arts'];
            for (const s of defaultStreams) {
                await query(`INSERT INTO streams (name) VALUES ($1) ON CONFLICT (name) DO NOTHING;`, [s]);
            }
            console.log('✅ Streams Preloaded');
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
        await query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username VARCHAR(100) NOT NULL, email VARCHAR(100) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL, role VARCHAR(20) DEFAULT 'user', is_premium BOOLEAN DEFAULT FALSE, premium_expiry TIMESTAMP, is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);

        // Ensure 'role' column exists (for cases where table already existed without it)
        try {
            await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user';`);
            await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;`);
            await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_left INTEGER DEFAULT 0;`);
        } catch (e) {
            console.log('Note: role/is_active/sessions_left column already exists or migration skipped.');
        }

        // User Daily Usage
        await query(`CREATE TABLE IF NOT EXISTS user_daily_usage (user_id INTEGER REFERENCES users(id), date DATE DEFAULT CURRENT_DATE, count INTEGER DEFAULT 0, PRIMARY KEY (user_id, date));`);

        // Categories
        await query(`CREATE TABLE IF NOT EXISTS categories (id SERIAL PRIMARY KEY, name VARCHAR(100) UNIQUE NOT NULL, image_url TEXT, description TEXT, is_active BOOLEAN DEFAULT TRUE, sort_order INTEGER DEFAULT 0);`);

        // States & UT
        await query(`CREATE TABLE IF NOT EXISTS states (id SERIAL PRIMARY KEY, name VARCHAR(100) UNIQUE NOT NULL, is_active BOOLEAN DEFAULT TRUE);`);
        try { await query(`ALTER TABLE states ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;`); } catch (e) { }

        // Languages
        await query(`CREATE TABLE IF NOT EXISTS languages (id SERIAL PRIMARY KEY, name VARCHAR(100) UNIQUE NOT NULL, is_active BOOLEAN DEFAULT TRUE);`);
        try { await query(`ALTER TABLE languages ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;`); } catch (e) { }

        // Hierarchy Tables
        await query(`CREATE TABLE IF NOT EXISTS boards (
            id SERIAL PRIMARY KEY, 
            name VARCHAR(500) NOT NULL, 
            state_id INTEGER REFERENCES states(id), 
            logo_url TEXT, 
            is_active BOOLEAN DEFAULT TRUE,
            CONSTRAINT unique_board_per_state UNIQUE (state_id, name)
        );`);
        try { await query(`ALTER TABLE boards ADD COLUMN IF NOT EXISTS logo_url TEXT;`); } catch (e) { }

        await query(`CREATE TABLE IF NOT EXISTS classes (
            id SERIAL PRIMARY KEY, 
            name VARCHAR(50) UNIQUE NOT NULL, 
            is_active BOOLEAN DEFAULT TRUE
        );`);
        await query(`CREATE TABLE IF NOT EXISTS streams (
            id SERIAL PRIMARY KEY, 
            name VARCHAR(500) UNIQUE NOT NULL, 
            is_active BOOLEAN DEFAULT TRUE
        );`);

        // Board -> Classes Explicit Mapping Table
        await query(`CREATE TABLE IF NOT EXISTS board_classes (
            id SERIAL PRIMARY KEY,
            board_id INTEGER REFERENCES boards(id) ON DELETE CASCADE,
            class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
            is_active BOOLEAN DEFAULT FALSE,
            CONSTRAINT unique_board_class UNIQUE (board_id, class_id)
        );`);

        await query(`CREATE TABLE IF NOT EXISTS universities (id SERIAL PRIMARY KEY, name VARCHAR(500) NOT NULL, state_id INTEGER REFERENCES states(id), logo_url TEXT, is_active BOOLEAN DEFAULT TRUE);`);
        try { await query(`ALTER TABLE universities ADD CONSTRAINT unique_university_state UNIQUE (state_id, name);`); } catch (e) { console.log('Constraint unique_university_state already exists'); }
        try { await query(`ALTER TABLE universities ADD COLUMN IF NOT EXISTS logo_url TEXT;`); } catch (e) { }

        await query(`CREATE TABLE IF NOT EXISTS degree_types (id SERIAL PRIMARY KEY, name VARCHAR(500) NOT NULL, is_active BOOLEAN DEFAULT TRUE);`);
        const defaultDegrees = ['B.A. Honours', 'B.Sc. Honours', 'B.Com. Honours', 'B.A. General/Pass', 'B.Sc. General/Pass', 'B.Com. General/Pass', 'B.E. / B.Tech', 'M.A.', 'M.Sc.', 'M.Com.'];
        for (const deg of defaultDegrees) {
            await query(`INSERT INTO degree_types (name) SELECT $1::varchar WHERE NOT EXISTS (SELECT 1 FROM degree_types WHERE name = $1::varchar);`, [deg]);
        }

        await query(`CREATE TABLE IF NOT EXISTS semesters (id SERIAL PRIMARY KEY, name VARCHAR(50) NOT NULL, university_id INTEGER REFERENCES universities(id), is_active BOOLEAN DEFAULT TRUE);`);
        try { await query(`ALTER TABLE semesters ADD CONSTRAINT unique_semester_university UNIQUE (university_id, name);`); } catch (e) { console.log('Constraint unique_semester_university already exists'); }

        await query(`CREATE TABLE IF NOT EXISTS papers_stages (id SERIAL PRIMARY KEY, name VARCHAR(500) NOT NULL, category_id INTEGER REFERENCES categories(id), is_active BOOLEAN DEFAULT TRUE);`);
        try { await query(`ALTER TABLE papers_stages ADD CONSTRAINT unique_paper_category UNIQUE (category_id, name);`); } catch (e) { console.log('Constraint unique_paper_category already exists'); }

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

        await query(`CREATE TABLE IF NOT EXISTS subjects (
            id SERIAL PRIMARY KEY, 
            name VARCHAR(500) NOT NULL, 
            category_id INTEGER REFERENCES categories(id), 
            board_id INTEGER REFERENCES boards(id), 
            university_id INTEGER REFERENCES universities(id), 
            class_id INTEGER REFERENCES classes(id), 
            stream_id INTEGER REFERENCES streams(id), 
            semester_id INTEGER REFERENCES semesters(id), 
            degree_type_id INTEGER REFERENCES degree_types(id), 
            paper_stage_id INTEGER REFERENCES papers_stages(id), 
            is_active BOOLEAN DEFAULT TRUE,
            CONSTRAINT unique_subject_hierarchy UNIQUE (board_id, class_id, name)
        );`);
        //-- Migration to update constraint for subjects (Handles NULL stream_id correctly in Postgres)
        try {
            await query(`ALTER TABLE subjects DROP CONSTRAINT IF EXISTS unique_subject_hierarchy;`);
            await query(`DROP INDEX IF EXISTS idx_unique_subject_with_stream;`);
            await query(`DROP INDEX IF EXISTS idx_unique_subject_no_stream;`);
            await query(`CREATE UNIQUE INDEX idx_unique_subject_with_stream ON subjects (board_id, class_id, stream_id, name) WHERE stream_id IS NOT NULL;`);
            await query(`CREATE UNIQUE INDEX idx_unique_subject_no_stream ON subjects (board_id, class_id, name) WHERE stream_id IS NULL;`);
        } catch (e) { console.log('Subject index migration: Handled.'); }
        try {
            await query(`ALTER TABLE subjects ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES categories(id);`);
            await query(`ALTER TABLE subjects ADD COLUMN IF NOT EXISTS university_id INTEGER REFERENCES universities(id);`);
            await query(`ALTER TABLE subjects ADD COLUMN IF NOT EXISTS semester_id INTEGER REFERENCES semesters(id);`);
            await query(`ALTER TABLE subjects ADD COLUMN IF NOT EXISTS degree_type_id INTEGER REFERENCES degree_types(id);`);
            await query(`ALTER TABLE subjects ADD COLUMN IF NOT EXISTS paper_stage_id INTEGER REFERENCES papers_stages(id);`);
        } catch (e) { }

        await query(`CREATE TABLE IF NOT EXISTS chapters (
            id SERIAL PRIMARY KEY, 
            name VARCHAR(500) NOT NULL, 
            subject_id INTEGER REFERENCES subjects(id), 
            description TEXT, 
            sort_order INTEGER DEFAULT 0, 
            is_active BOOLEAN DEFAULT TRUE,
            CONSTRAINT unique_chapter_per_subject UNIQUE (subject_id, name)
        );`);
        try {
            await query(`ALTER TABLE chapters ADD COLUMN IF NOT EXISTS description TEXT;`);
            await query(`ALTER TABLE chapters ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;`);
        } catch (e) { }

        // --- MIGRATION: Ensure 'is_active' exists on all legacy tables ---
        const tablesToMigrate = [
            'categories', 'boards', 'classes', 'streams', 'board_classes',
            'universities', 'degree_types', 'semesters', 'papers_stages',
            'subjects', 'chapters'
        ];
        for (const tableName of tablesToMigrate) {
            try {
                await query(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;`);
            } catch (e) {
                console.log(`Migration for ${tableName}.is_active: Handled or skipped.`);
            }
        }
        // ----------------------------------------------------------------

        // Other System Tables
        await query(`CREATE TABLE IF NOT EXISTS subscription_plans (
            id SERIAL PRIMARY KEY, 
            name VARCHAR(50) NOT NULL, 
            duration_hours INTEGER NOT NULL, 
            price DECIMAL(10, 2) NOT NULL, 
            is_active BOOLEAN DEFAULT TRUE,
            sessions_limit INTEGER DEFAULT 0,
            referral_bonus_sessions INTEGER DEFAULT 0
        );`);

        // Migration to add session columns if table already exists
        try {
            await query(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS sessions_limit INTEGER DEFAULT 0;`);
            await query(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS referral_bonus_sessions INTEGER DEFAULT 0;`);
        } catch (e) { }

        // Clean up duplicates and add unique constraint
        try {
            await query(`DELETE FROM subscription_plans a USING subscription_plans b WHERE a.id < b.id AND a.name = b.name;`);
            await query(`ALTER TABLE subscription_plans ADD CONSTRAINT unique_plan_name UNIQUE (name);`);
        } catch (e) { console.log('Constraint unique_plan_name already exists'); }

        await query(`INSERT INTO subscription_plans (name, duration_hours, price, sessions_limit, referral_bonus_sessions) VALUES ('1 Hour Pass', 1, 10, 5, 1), ('3 Hour Pass', 3, 25, 15, 3) ON CONFLICT (name) DO NOTHING;`);
        await query(`CREATE TABLE IF NOT EXISTS payments (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), razorpay_order_id VARCHAR(100), razorpay_payment_id VARCHAR(100), amount DECIMAL(10, 2), status VARCHAR(20), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
        await query(`CREATE TABLE IF NOT EXISTS referrals (id SERIAL PRIMARY KEY, referrer_id INTEGER REFERENCES users(id), referred_user_id INTEGER REFERENCES users(id), status VARCHAR(20) DEFAULT 'pending', reward_given BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);

        // Legal Pages Table (Requirement 7)
        await query(`CREATE TABLE IF NOT EXISTS legal_pages (
            id SERIAL PRIMARY KEY,
            slug VARCHAR(50) UNIQUE NOT NULL,
            title VARCHAR(100) NOT NULL,
            content TEXT,
            is_active BOOLEAN DEFAULT TRUE,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );`);
        const defaultLegal = [
            ['privacy-policy', 'Privacy Policy'],
            ['terms-conditions', 'Terms & Conditions'],
            ['refund-policy', 'Refund Policy'],
            ['about-us', 'About Us'],
            ['contact-us', 'Contact Us']
        ];
        for (const [slug, title] of defaultLegal) {
            await query(`INSERT INTO legal_pages (slug, title) VALUES ($1, $2) ON CONFLICT (slug) DO NOTHING;`, [slug, title]);
        }
        // Free Limit Control Table (Requirement 4)
        await query(`CREATE TABLE IF NOT EXISTS free_limit_settings (
            id SERIAL PRIMARY KEY,
            key VARCHAR(50) UNIQUE NOT NULL,
            value TEXT NOT NULL,
            description TEXT
        );`);
        const limitDefaults = {
            'FREE_SESSIONS_COUNT': '2',
            'FREE_SESSION_MCQS': '10',
            'FREE_SESSION_MINUTES': '15',
            'POPUP_HEADING': 'Free Limit Reached!',
            'POPUP_TEXT': 'Master your exams with Prime. Get unlimited practice now!',
            'RENEWAL_WINDOW_HOURS': '24'
        };
        for (const [key, value] of Object.entries(limitDefaults)) {
            await query(`INSERT INTO free_limit_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING;`, [key, value]);
        }

        // AI Provider Enhanced Table (Requirement 7)
        await query(`CREATE TABLE IF NOT EXISTS ai_providers (
            id SERIAL PRIMARY KEY, 
            name VARCHAR(100), 
            base_url TEXT, 
            api_key TEXT, 
            model_name TEXT, 
            is_active BOOLEAN DEFAULT FALSE
        );`);
        try {
            // Sanitize duplicates before adding constraint
            await query(`DELETE FROM ai_providers a USING ai_providers b WHERE a.id < b.id AND a.name = b.name;`);
            await query(`ALTER TABLE ai_providers ADD CONSTRAINT unique_ai_provider_name UNIQUE (name);`);
        } catch (e) { }

        // Seed default AI providers — only insert if NOT exists, never overwrite admin changes
        const geminiKey = process.env.AI_API_KEY || process.env.GEMINI_API_KEY || '';
        console.log(`AI Provider Sync: Gemini Key detected? ${!!geminiKey}`);

        // Google Gemini — insert only if not already present. If AI_API_KEY is set, update the key.
        if (geminiKey) {
            await query(`INSERT INTO ai_providers (name, base_url, api_key, model_name, is_active) 
                VALUES ('Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/models', $1, 'gemini-1.5-flash', FALSE) 
                ON CONFLICT (name) DO UPDATE SET api_key = EXCLUDED.api_key WHERE ai_providers.api_key IS NULL OR ai_providers.api_key = '';`,
                [geminiKey]);
        } else {
            await query(`INSERT INTO ai_providers (name, base_url, api_key, model_name, is_active) 
                VALUES ('Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/models', '', 'gemini-1.5-flash', FALSE) 
                ON CONFLICT (name) DO NOTHING;`);
        }

        // OpenRouter — always seed the row, never overwrite if already configured
        await query(`INSERT INTO ai_providers (name, base_url, api_key, model_name, is_active) 
            VALUES ('OpenRouter', 'https://openrouter.ai/api/v1', '', 'meta-llama/llama-3.1-8b-instruct:free', FALSE) 
            ON CONFLICT (name) DO NOTHING;`);

        console.log('✅ AI Providers seeded (existing config preserved).');

        // Payment Gateway Settings (Requirement 6)
        await query(`CREATE TABLE IF NOT EXISTS payment_gateway_settings (
            id SERIAL PRIMARY KEY,
            provider VARCHAR(50) UNIQUE NOT NULL,
            api_key TEXT,
            api_secret TEXT,
            is_active BOOLEAN DEFAULT FALSE
        );`);
        await query(`INSERT INTO payment_gateway_settings (provider) VALUES ('razorpay'), ('stripe') ON CONFLICT (provider) DO NOTHING;`);

        // Hierarchy Tables - Adding is_approved (Requirements 2, 3, 9)
        const hierarchyTables = ['boards', 'universities', 'subjects', 'chapters', 'papers_stages', 'degree_types', 'semesters'];
        for (const table of hierarchyTables) {
            try {
                await query(`ALTER TABLE ${table} ALTER COLUMN name TYPE VARCHAR(500);`);
                await query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT FALSE;`);
                await query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;`);
            } catch (e) { }
        }

        // --- SCHEMA REPAIR: Dupe Cleanup & UNIQUE Constraints for ON CONFLICT ---
        const repairConfigs = [
            { table: 'boards', cols: ['state_id', 'name'], name: 'unique_board_per_state' },
            { table: 'universities', cols: ['state_id', 'name'], name: 'unique_university_state' },
            { table: 'papers_stages', cols: ['category_id', 'name'], name: 'unique_paper_category' },
            { table: 'chapters', cols: ['subject_id', 'name'], name: 'unique_chapter_per_subject' }
        ];

        for (const cfg of repairConfigs) {
            try {
                console.log(`Repairing schema for ${cfg.table}...`);
                // 1. Delete duplicates based on the target columns
                const colA = cfg.cols[0];
                const colB = cfg.cols[1];
                await query(`DELETE FROM ${cfg.table} a USING ${cfg.table} b 
                             WHERE a.id < b.id 
                             AND (a.${colA} = b.${colA} OR (a.${colA} IS NULL AND b.${colA} IS NULL)) 
                             AND a.${colB} = b.${colB};`);

                // 2. Add the UNIQUE constraint
                await query(`ALTER TABLE ${cfg.table} ADD CONSTRAINT ${cfg.name} UNIQUE (${cfg.cols.join(', ')});`);
                console.log(`✅ Constraint ${cfg.name} enforced on ${cfg.table}.`);
            } catch (e) {
                // If it already exists, this will fail silently which is fine
            }
        }

        // SEO and Site Config (Requirement 8)
        const siteDefaults = {
            'SITE_TITLE': 'ExamRedy - AI MCQ Practice',
            'META_DESCRIPTION': 'Master your exams with AI-powered personalized MCQ sets.',
            'META_KEYWORDS': 'MCQ, Exam Practice, AI, School, University, India',
            'GOOGLE_ANALYTICS_ID': '',
            'GOOGLE_SEARCH_CONSOLE_CODE': '',
            'FOOTER_TEXT': '© 2026 ExamRedy. All rights reserved.',
            'SUPPORT_EMAIL': 'support@examredy.in',
            'WHATSAPP_NUMBER': ''
        };
        for (const [key, value] of Object.entries(siteDefaults)) {
            await query(`INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING;`, [key, value]);
        }

        // Insert default settings if not exists
        await query(`INSERT INTO system_settings (key, value) VALUES ('GROUP_SIZE_LIMIT', '15') ON CONFLICT (key) DO UPDATE SET value = '15';`);
        await query(`INSERT INTO system_settings (key, value) VALUES ('REFERRAL_BONUS_DAYS', '7') ON CONFLICT (key) DO NOTHING;`);

        // AI Fetch Logs (Requirement 6)
        await query(`CREATE TABLE IF NOT EXISTS ai_fetch_logs (
            id SERIAL PRIMARY KEY,
            type VARCHAR(50) NOT NULL,
            context TEXT,
            status VARCHAR(20),
            error_message TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );`);

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
        await query(`CREATE TABLE IF NOT EXISTS group_sessions (
            id VARCHAR(50) PRIMARY KEY, 
            creator_id INTEGER REFERENCES users(id), 
            status VARCHAR(20) DEFAULT 'lobby', 
            category_id INTEGER REFERENCES categories(id),
            mcq_ids JSONB,
            mcq_data JSONB,
            is_active BOOLEAN DEFAULT TRUE, 
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );`);

        // Migrate group_sessions for existing tables
        try {
            await query(`ALTER TABLE group_sessions ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'lobby';`);
            await query(`ALTER TABLE group_sessions ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES categories(id);`);
            await query(`ALTER TABLE group_sessions ADD COLUMN IF NOT EXISTS mcq_ids JSONB;`);
            await query(`ALTER TABLE group_sessions ADD COLUMN IF NOT EXISTS mcq_data JSONB;`);
        } catch (e) { console.log('Group sessions migration: Handled.'); }

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
            console.log('Admin user verified. Ensuring role integrity...');
            await query('UPDATE users SET role = $1 WHERE email = $2', ['admin', adminEmail]);
            console.log('✅ Admin role synchronized.');
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

        // --- DATA HYGIENE (Requirement 2 & 4) ---
        // Purge any pre-existing dummy/sample data to avoid confusion with real AI data
        console.log('Running Data Hygiene: Purging Sample/Dummy records...');
        await query(`DELETE FROM chapters WHERE name ILIKE '%SAMPLE%' OR name ILIKE '%TEST%' OR name ILIKE '%DUMMY%';`);
        await query(`DELETE FROM subjects WHERE name ILIKE '%SAMPLE%' OR name ILIKE '%TEST%' OR name ILIKE '%DUMMY%';`);
        await query(`DELETE FROM boards WHERE name ILIKE '%SAMPLE%' OR name ILIKE '%TEST%' OR name ILIKE '%DUMMY%' OR name ILIKE 'DEBUG_%' OR name ILIKE '%FIX-V1%' OR name ILIKE '%REQUEST FAILED%';`);
        console.log('✅ Data Hygiene Complete: Only Real Data remains.');

        // Run Preload after DB init
        await preloadData();

    } catch (err) {
        console.error('❌ Error initializing database tables:', err);
    }
};

module.exports = { pool, query, initDB };
