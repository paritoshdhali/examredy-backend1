const jwt = require('jsonwebtoken');
const { query } = require('../db');

const verifyToken = async (req, res, next) => {
    let token;

    const authHeader = req.headers.authorization || req.headers.Authorization;

    if (authHeader && authHeader.toLowerCase().startsWith('bearer')) {
        try {
            token = authHeader.split(' ')[1];
            console.log(`[AUTH-DEBUG] Token extracted for ${req.path}`);

            if (!token) {
                console.warn(`[AUTH-DEBUG] Authorization header found but token missing in ${req.path}`);
                return res.status(401).json({ message: 'Not authorized, token missing in Bearer' });
            }

            if (!token) {
                return res.status(401).json({ message: 'Not authorized, token missing' });
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'examredy_secret_2026_fallback');

            // Fetch user from DB to ensure valid and attach to req
            const result = await query('SELECT id, username, email, role, is_premium, premium_expiry, is_active, sessions_left FROM users WHERE id = $1', [decoded.id]);

            if (result.rows.length === 0) {
                return res.status(401).json({ message: 'Not authorized, user not found' });
            }

            const user = result.rows[0];

            if (user.is_active === false) {
                return res.status(403).json({ message: 'Your account is disabled' });
            }

            req.user = user;
            return next();
        } catch (error) {
            console.error('Auth Error:', error.message);
            return res.status(401).json({ message: `Not authorized, token failed: ${error.message}` });
        }
    }

    if (!token) {
        return res.status(401).json({ message: 'Not authorized, no token provided' });
    }
};

const admin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: 'Not authorized as an admin' });
    }
};

module.exports = { verifyToken, admin };
