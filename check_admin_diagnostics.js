const { query } = require('./db');

async function checkAdmin() {
    try {
        const res = await query("SELECT id, email, password, role FROM users WHERE email = 'admin@examredy.in'");
        if (res.rows.length === 0) {
            console.log('Admin user not found');
        } else {
            const user = res.rows[0];
            console.log('Admin exists. Role:', user.role);
            console.log('Password starts with $2b$ or $2a$ (bcrypt)?', user.password.startsWith('$2b$') || user.password.startsWith('$2a$'));
            console.log('Password length:', user.password.length);
            console.log('Password string:', user.password);
        }
    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

checkAdmin();
