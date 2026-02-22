const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { hashPassword, comparePassword, generateToken } = require('../utils/helpers');
const { verifyToken } = require('../middleware/authMiddleware');

// @route   GET /api/auth
// @desc    Auth health check
// @access  Public
router.get('/', (req, res) => {
    res.json({ message: 'Auth service is running' });
});

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', async (req, res) => {
    const { username, email, password, referrer_id } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ message: 'Please add all fields' });
    }

    try {
        // Check if user exists
        const userExists = await query('SELECT * FROM users WHERE email = $1', [email]);

        if (userExists.rows.length > 0) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // Hash password
        const hashedPassword = await hashPassword(password);

        // Create user
        const newUser = await query(
            'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email, role',
            [username, email, hashedPassword]
        );

        const user = newUser.rows[0];

        // Handle Referral
        if (referrer_id) {
            // Validate referrer exists
            const referrer = await query('SELECT id FROM users WHERE id = $1', [referrer_id]);
            if (referrer.rows.length > 0) {
                await query(
                    'INSERT INTO referrals (referrer_id, referred_user_id) VALUES ($1, $2)',
                    [referrer_id, user.id]
                );
            }
        }

        res.status(201).json({
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role || 'user',
            token: generateToken(user.id, user.role || 'user'),
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/auth/login
// @desc    Authenticate user & get token
// @access  Public
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        console.log(`Login attempt: ${email}`);
        // Check for user email
        const result = await query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        if (!user) {
            console.warn(`Login failed: User not found for ${email}`);
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        let isMatch = await comparePassword(password, user.password);
        console.log(`Bcrypt match for ${email}: ${isMatch}`);

        if (isMatch) {
            console.log(`Login successful for ${email}`);
            res.json({
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role,
                is_premium: user.is_premium,
                token: generateToken(user.id, user.role, user.email),
            });
        } else {
            console.warn(`Login failed: Incorrect password for ${email}`);
            res.status(400).json({ message: 'Invalid credentials' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/auth/me
// @desc    Get current user data
// @access  Private
router.get('/me', verifyToken, async (req, res) => {
    res.json(req.user);
});

// @route   POST /api/auth/google
// @desc    Authenticate with Google OAuth
// @access  Public
router.post('/google', async (req, res) => {
    const { credential, referrer_id } = req.body; // credential here will be the access_token

    if (!credential) {
        return res.status(400).json({ message: 'Google credential missing' });
    }

    try {
        // Fetch user info using the access token
        const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${credential}` }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch user info from Google');
        }

        const payload = await response.json();
        const { email, name } = payload;

        // Check if user exists by email
        const userExists = await query('SELECT * FROM users WHERE email = $1', [email]);
        let user;

        if (userExists.rows.length > 0) {
            // User exists, log them in
            user = userExists.rows[0];
            console.log(`Google Login successful for existing user: ${email}`);
        } else {
            // User does not exist, create a new account
            // Since it's a social login, we generate a random complex password
            const randomPassword = require('crypto').randomBytes(16).toString('hex');
            const hashedPassword = await hashPassword(randomPassword);

            // Use the Google name or fallback to part of the email
            const username = name || email.split('@')[0];

            const newUser = await query(
                'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email, role, is_premium',
                [username, email, hashedPassword]
            );

            user = newUser.rows[0];
            console.log(`Google Auto-Registration successful for new user: ${email}`);

            // Handle Referral Logic if provided
            if (referrer_id) {
                const referrer = await query('SELECT id FROM users WHERE id = $1', [referrer_id]);
                if (referrer.rows.length > 0) {
                    await query(
                        'INSERT INTO referrals (referrer_id, referred_user_id) VALUES ($1, $2)',
                        [referrer_id, user.id]
                    );
                }
            }
        }

        // Return standard authentication response matching normal login
        res.json({
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role || 'user',
            is_premium: user.is_premium || false,
            token: generateToken(user.id, user.role || 'user', user.email)
        });

    } catch (error) {
        console.error('Google Auth Error:', error);
        res.status(401).json({ message: 'Invalid Google authentication token' });
    }
});

module.exports = router;
