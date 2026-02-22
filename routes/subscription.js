const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { pool, query } = require('../db');
const { verifyToken, admin } = require('../middleware/authMiddleware');

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'secret_placeholder'
});

// @route   GET /api/subscription
// @desc    Subscription health check
// @access  Public
router.get('/', (req, res) => {
    res.json({ message: 'Subscription service is running' });
});

// @route   GET /api/subscription/plans
// @desc    Get all active subscription plans
// @access  Public
router.get('/plans', async (req, res) => {
    try {
        const result = await query('SELECT * FROM subscription_plans WHERE is_active = TRUE');
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/subscription/plans
// @desc    Create a new plan
// @access  Admin
router.post('/plans', verifyToken, admin, async (req, res) => {
    const { name, duration_hours, price } = req.body;
    try {
        const result = await query(
            'INSERT INTO subscription_plans (name, duration_hours, price) VALUES ($1, $2, $3) RETURNING *',
            [name, duration_hours, price]
        );
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/subscription/create-order
// @desc    Create Razorpay order
// @access  Private
router.post('/create-order', verifyToken, async (req, res) => {
    const { planId } = req.body;
    try {
        const planResult = await query('SELECT * FROM subscription_plans WHERE id = $1', [planId]);
        if (planResult.rows.length === 0) {
            return res.status(404).json({ message: 'Plan not found' });
        }
        const plan = planResult.rows[0];

        const options = {
            amount: plan.price * 100, // amount in smallest currency unit check (paise)
            currency: "INR",
            receipt: `order_rcptid_${Date.now()}_${req.user.id}`
        };

        const order = await razorpay.orders.create(options);
        res.json(order);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/subscription/verify-payment
// @desc    Verify Razorpay payment and activate subscription
// @access  Private
router.post('/verify-payment', verifyToken, async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, planId } = req.body;

    // Verify signature
    const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'secret_placeholder');
    hmac.update(razorpay_order_id + "|" + razorpay_payment_id);
    const generated_signature = hmac.digest('hex');

    if (generated_signature !== razorpay_signature) {
        return res.status(400).json({ message: 'Invalid signature' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Get Plan
        const planResult = await client.query('SELECT * FROM subscription_plans WHERE id = $1', [planId]);
        const plan = planResult.rows[0];

        // 2. Record Payment
        await client.query(
            'INSERT INTO payments (user_id, razorpay_order_id, razorpay_payment_id, amount, status) VALUES ($1, $2, $3, $4, $5)',
            [req.user.id, razorpay_order_id, razorpay_payment_id, plan.price, 'captured']
        );

        // 3. Activate Subscription for User (Fix: Use Transaction Timestamp or proper date logic)
        // If user already premium, extend? For now, we overwrite or simple switch.
        // Simple logic: Premium activates NOW for X hours.
        const expiry = new Date();
        expiry.setHours(expiry.getHours() + plan.duration_hours);

        await client.query(
            'UPDATE users SET is_premium = TRUE, premium_expiry = $1 WHERE id = $2',
            [expiry, req.user.id]
        );

        // 4. CHECK REFERRAL REWARD
        const sysResult = await client.query("SELECT key, value FROM system_settings WHERE key IN ('REFERRAL_ENABLED', 'REFERRAL_REWARD_TYPE', 'REFERRAL_REWARD_DURATION', 'REFERRAL_MIN_PURCHASE_RS')");
        const sys = Object.fromEntries(sysResult.rows.map(r => [r.key, r.value]));

        if (sys.REFERRAL_ENABLED === 'true' && plan.price >= parseFloat(sys.REFERRAL_MIN_PURCHASE_RS || 0)) {
            const referralCheck = await client.query(
                `SELECT * FROM referrals WHERE referred_user_id = $1 AND reward_given = FALSE`,
                [req.user.id]
            );

            if (referralCheck.rows.length > 0) {
                const referrerId = referralCheck.rows[0].referrer_id;
                const refId = referralCheck.rows[0].id;

                const type = sys.REFERRAL_REWARD_TYPE || 'days';
                const duration = parseInt(sys.REFERRAL_REWARD_DURATION || 2);
                const intervalStr = type === 'hours' ? `${duration} hours` : `${duration} days`;

                // Give Reward to Referrer
                await client.query(`UPDATE users SET is_premium = TRUE, premium_expiry = GREATEST(COALESCE(premium_expiry, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP) + INTERVAL '${intervalStr}' WHERE id = $1`, [referrerId]);

                // Give Reward to Referred User (extra bonus on top of their purchase)
                await client.query(`UPDATE users SET is_premium = TRUE, premium_expiry = GREATEST(COALESCE(premium_expiry, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP) + INTERVAL '${intervalStr}' WHERE id = $1`, [req.user.id]);

                // Mark reward given
                await client.query(`UPDATE referrals SET reward_given = TRUE, status = 'completed' WHERE id = $1`, [refId]);
            }
        }

        await client.query('COMMIT');
        res.json({ message: 'Payment verified and subscription activated' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        client.release();
    }
});

module.exports = router;

