const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { pool, query } = require('../db');
const { verifyToken, admin } = require('../middleware/authMiddleware');

const getRazorpayInstance = async () => {
    const res = await query("SELECT api_key, api_secret FROM payment_gateway_settings WHERE provider = 'razorpay' AND is_active = TRUE");

    const key_id = res.rows[0]?.api_key || process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder';
    const key_secret = res.rows[0]?.api_secret || process.env.RAZORPAY_KEY_SECRET || 'secret_placeholder';

    return new Razorpay({
        key_id,
        key_secret
    });
};

// @route   GET /api/subscription/config
// @desc    Get public config (Razorpay ID)
// @access  Public
router.get('/config', async (req, res) => {
    try {
        const result = await query("SELECT api_key FROM payment_gateway_settings WHERE provider = 'razorpay' AND is_active = TRUE");
        const key_id = result.rows[0]?.api_key || process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder';
        res.json({ key_id });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
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

        const rzp = await getRazorpayInstance();

        // Ensure price is a number and convert to paise (cents) correctly
        const amountPaise = Math.round(parseFloat(plan.price) * 100);

        console.log(`Creating order for plan ${planId}, amount: ${amountPaise} paise`);

        const options = {
            amount: amountPaise,
            currency: "INR",
            receipt: `order_rcptid_${Date.now()}_${req.user.id}`
        };

        const order = await rzp.orders.create(options);
        res.json(order);
    } catch (error) {
        console.error('Order creation error details:', error);
        res.status(500).json({
            message: 'Failed to create payment order',
            error: error.description || error.message
        });
    }
});

// @route   POST /api/subscription/verify-payment
// @desc    Verify Razorpay payment and activate subscription
// @access  Private
router.post('/verify-payment', verifyToken, async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, planId } = req.body;

    // Get dynamic secret
    const gatewayRes = await query("SELECT api_secret FROM payment_gateway_settings WHERE provider = 'razorpay' AND is_active = TRUE");
    const key_secret = gatewayRes.rows[0]?.api_secret || process.env.RAZORPAY_KEY_SECRET || 'secret_placeholder';

    // Verify signature
    const hmac = crypto.createHmac('sha256', key_secret);
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

        // 3. Activate Subscription for User
        // Grant sessions from the plan
        await client.query(
            'UPDATE users SET is_premium = TRUE, sessions_left = sessions_left + $1 WHERE id = $2',
            [plan.sessions_limit, req.user.id]
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

                // Grant referral bonus sessions to referrer
                if (plan.referral_bonus_sessions > 0) {
                    await client.query(`UPDATE users SET sessions_left = sessions_left + $1, is_premium = TRUE WHERE id = $2`, [plan.referral_bonus_sessions, referrerId]);
                }

                // Grant referral bonus sessions to referred user as well (optional, using plan's bonus)
                if (plan.referral_bonus_sessions > 0) {
                    await client.query(`UPDATE users SET sessions_left = sessions_left + $1 WHERE id = $2`, [plan.referral_bonus_sessions, req.user.id]);
                }

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

