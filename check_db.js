const { query } = require('./db');
async function run() {
    try {
        const res = await query('SELECT * FROM subjects WHERE board_id = 66 AND class_id = 1');
        console.log('SUBJECTS:', JSON.stringify(res.rows, null, 2));
        const chap = await query('SELECT * FROM chapters LIMIT 5');
        console.log('CHAPTERS:', JSON.stringify(chap.rows, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
run();
