
const { query } = require('./db');
const axios = require('axios');

async function testFetch() {
    try {
        // Find a board
        const boards = await query('SELECT id, name FROM boards LIMIT 1');
        if (boards.rows.length === 0) {
            console.log('No boards found');
            return;
        }
        const board = boards.rows[0];
        console.log(`Testing with Board: ${board.name} (ID: ${board.id})`);

        // We can't easily call the API because it needs auth.
        // Let's simulate the logic from routes/aiFetch.js directly.

        const allClasses = await query('SELECT id, name FROM classes ORDER BY id ASC');
        let classesToOffer = allClasses.rows;

        const board_name = board.name;
        const n = (board_name || '').toLowerCase();

        console.log(`Board Name: ${board_name}`);

        if (n.includes('higher secondary') || n.includes('intermediate') || n.includes('pre-university') || n.includes('+2') || n.includes('hsc') || n.includes('council of higher')) {
            classesToOffer = classesToOffer.filter(c => parseInt(c.name.replace(/\D/g, '')) >= 11);
        } else if (n.includes('primary') || n.includes('elementary')) {
            classesToOffer = classesToOffer.filter(c => parseInt(c.name.replace(/\D/g, '')) <= 5);
        } else if ((n.includes('secondary') && !n.includes('higher')) || n.includes('madhyamik') || n.includes('matriculation') || n.includes('sslc')) {
            classesToOffer = classesToOffer.filter(c => parseInt(c.name.replace(/\D/g, '')) <= 10);
        }

        console.log(`Classes to offer count: ${classesToOffer.length}`);
        classesToOffer.forEach(c => console.log(` - ${c.name}`));

        // Check board_classes
        const boardClasses = await query('SELECT * FROM board_classes WHERE board_id = $1', [board.id]);
        console.log(`Existing links for this board: ${boardClasses.rows.length}`);

    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}

testFetch();
