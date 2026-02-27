const { query } = require('./db');
async function check() {
    try {
        const res = await query(`
            SELECT constraint_name, constraint_type 
            FROM information_schema.table_constraints 
            WHERE table_name = 'chapters'
        `);
        console.log('Constraints:', JSON.stringify(res.rows, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
check();
