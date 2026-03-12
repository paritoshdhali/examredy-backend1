const bcrypt = require('bcryptjs');
const { query } = require('./db');

async function resetPassword() {
    try {
        const defaultPassword = 'admin123';
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(defaultPassword, salt);

        console.log('Resetting password for admin@examredy.in...');
        const result = await query(
            "UPDATE users SET password = $1 WHERE email = 'admin@examredy.in' RETURNING id, email",
            [hashedPassword]
        );

        if (result.rows.length > 0) {
            console.log(`Success! Password for ${result.rows[0].email} set back to admin123`);
        } else {
            console.log('Failed: admin@examredy.in not found in database.');
        }
    } catch (err) {
        console.error('Error resetting password:', err);
    } finally {
        process.exit(0);
    }
}

resetPassword();
