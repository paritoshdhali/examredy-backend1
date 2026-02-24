const { query } = require('./db');
async function run() {
    try {
        const res = await query('SELECT id, name FROM boards WHERE state_id = 29');
        console.log('BOARDS for State 29:', res.rows);
        for (const b of res.rows) {
            const subCount = await query('SELECT COUNT(*) FROM subjects WHERE board_id = $1', [b.id]);
            console.log(`Board ${b.id} (${b.name}) has ${subCount.rows[0].count} subjects`);
        }
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
run();
