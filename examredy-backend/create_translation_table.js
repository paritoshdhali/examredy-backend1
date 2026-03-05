const { query } = require('./db');

async function createTranslationCache() {
    try {
        await query(`
            CREATE TABLE IF NOT EXISTS name_translations (
                id SERIAL PRIMARY KEY,
                table_name VARCHAR(50) NOT NULL,
                item_id INTEGER NOT NULL,
                language VARCHAR(50) NOT NULL,
                translated_name TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE (table_name, item_id, language)
            )
        `);
        console.log('✅ name_translations table created (or already exists)');
        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
}

createTranslationCache();
