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

// @route   GET /api/subscription/initiate-payment
// @desc    Server-side payment page — used by Flutter WebView to navigate directly
//          Creates Razorpay order + renders auto-submit HTML form to Razorpay
// @access  Private (token in query param)
router.get('/initiate-payment', async (req, res) => {
    const { token, planId } = req.query;
    const frontendUrl = process.env.FRONTEND_URL || 'https://examredy-frontend.vercel.app';

    if (!token || !planId) {
        return res.redirect(`${frontendUrl}/prime?payment=failed&reason=missing_params`);
    }

    // Verify JWT token manually
    let userId;
    try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        userId = decoded.id || decoded.userId;
    } catch (e) {
        return res.redirect(`${frontendUrl}/prime?payment=failed&reason=auth_failed`);
    }

    try {
        const planResult = await query('SELECT * FROM subscription_plans WHERE id = $1', [planId]);
        if (planResult.rows.length === 0) {
            return res.redirect(`${frontendUrl}/prime?payment=failed&reason=plan_not_found`);
        }
        const plan = planResult.rows[0];

        const rzp = await getRazorpayInstance();
        const amountPaise = Math.round(parseFloat(plan.price) * 100);
        const order = await rzp.orders.create({
            amount: amountPaise,
            currency: 'INR',
            receipt: `order_rcptid_${Date.now()}_${userId}`
        });

        const gatewayRes = await query("SELECT api_key FROM payment_gateway_settings WHERE provider = 'razorpay' AND is_active = TRUE");
        const key_id = gatewayRes.rows[0]?.api_key || process.env.RAZORPAY_KEY_ID || '';

        const userRes = await query('SELECT username, email FROM users WHERE id = $1', [userId]);
        const user = userRes.rows[0] || {};

        const callbackUrl = `https://examredy-backend1-production.up.railway.app/api/subscription/payment-callback?planId=${planId}`;
        const cancelUrl = `${frontendUrl}/prime?payment=failed&reason=cancelled`;

        // Return HTML page with auto-submit form to Razorpay embedded checkout
        res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ExamRedy Payment</title>
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #1a1a2e; color: white; }
    .card { text-align: center; padding: 32px; }
    .spinner { width: 48px; height: 48px; border: 4px solid rgba(255,255,255,0.1); border-top-color: #4f46e5; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 20px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <p>Redirecting to payment...</p>
  </div>
  <form id="rzp" method="POST" action="https://api.razorpay.com/v1/checkout/embedded">
    <input type="hidden" name="key_id" value="${key_id}">
    <input type="hidden" name="order_id" value="${order.id}">
    <input type="hidden" name="name" value="ExamRedy">
    <input type="hidden" name="description" value="Premium - ${plan.name}">
    <input type="hidden" name="prefill[name]" value="${user.username || ''}">
    <input type="hidden" name="prefill[email]" value="${user.email || ''}">
    <input type="hidden" name="callback_url" value="${callbackUrl}">
    <input type="hidden" name="cancel_url" value="${cancelUrl}">
  </form>
  <script>document.getElementById('rzp').submit();</script>
</body>
</html>`);

    } catch (error) {
        console.error('[INITIATE-PAYMENT]', error);
        return res.redirect(`${frontendUrl}/prime?payment=failed&reason=server_error`);
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

// @route   POST /api/subscription/payment-callback
// @desc    Razorpay embedded checkout callback (Razorpay POSTs here after payment)
// @access  Public (Razorpay calls this)
router.post('/payment-callback', async (req, res) => {
    const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
    } = req.body;

    // planId can come from query param (we put it in callback_url) or body
    const planId = req.query.planId || req.body.planId;

    const frontendUrl = process.env.FRONTEND_URL || 'https://examredy-frontend.vercel.app';

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !planId) {
        return res.redirect(`${frontendUrl}/prime?payment=failed&reason=missing_params`);
    }

    try {
        // Get dynamic secret
        const gatewayRes = await query("SELECT api_secret FROM payment_gateway_settings WHERE provider = 'razorpay' AND is_active = TRUE");
        const key_secret = gatewayRes.rows[0]?.api_secret || process.env.RAZORPAY_KEY_SECRET || 'secret_placeholder';

        // Verify signature
        const hmac = require('crypto').createHmac('sha256', key_secret);
        hmac.update(razorpay_order_id + "|" + razorpay_payment_id);
        const generated_signature = hmac.digest('hex');

        if (generated_signature !== razorpay_signature) {
            return res.redirect(`${frontendUrl}/prime?payment=failed&reason=invalid_signature`);
        }

        // Find user by looking up the order in payments table or from razorpay order notes
        // We need to get the user_id from the order — look it up via Razorpay order ID
        const rzp = await getRazorpayInstance();
        const order = await rzp.orders.fetch(razorpay_order_id);
        const receiptParts = order.receipt?.split('_') || [];
        // receipt format: order_rcptid_{timestamp}_{userId}
        const userId = receiptParts[receiptParts.length - 1];

        if (!userId || isNaN(parseInt(userId))) {
            return res.redirect(`${frontendUrl}/prime?payment=failed&reason=user_not_found`);
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Get Plan
            const planResult = await client.query('SELECT * FROM subscription_plans WHERE id = $1', [planId]);
            if (planResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.redirect(`${frontendUrl}/prime?payment=failed&reason=plan_not_found`);
            }
            const plan = planResult.rows[0];

            // 2. Check not already processed (idempotency)
            const existingPayment = await client.query(
                'SELECT id FROM payments WHERE razorpay_payment_id = $1', [razorpay_payment_id]
            );
            if (existingPayment.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.redirect(`${frontendUrl}/prime?payment=success`);
            }

            // 3. Record Payment
            await client.query(
                'INSERT INTO payments (user_id, razorpay_order_id, razorpay_payment_id, amount, status) VALUES ($1, $2, $3, $4, $5)',
                [userId, razorpay_order_id, razorpay_payment_id, plan.price, 'captured']
            );

            // 4. Activate Subscription
            await client.query(
                'UPDATE users SET is_premium = TRUE, sessions_left = sessions_left + $1 WHERE id = $2',
                [plan.sessions_limit, userId]
            );

            // 5. Referral Reward
            const sysResult = await client.query("SELECT key, value FROM system_settings WHERE key IN ('REFERRAL_ENABLED', 'REFERRAL_REWARD_TYPE', 'REFERRAL_REWARD_DURATION', 'REFERRAL_MIN_PURCHASE_RS')");
            const sys = Object.fromEntries(sysResult.rows.map(r => [r.key, r.value]));

            if (sys.REFERRAL_ENABLED === 'true' && plan.price >= parseFloat(sys.REFERRAL_MIN_PURCHASE_RS || 0)) {
                const referralCheck = await client.query(
                    `SELECT * FROM referrals WHERE referred_user_id = $1 AND reward_given = FALSE`, [userId]
                );
                if (referralCheck.rows.length > 0) {
                    const referrerId = referralCheck.rows[0].referrer_id;
                    const refId = referralCheck.rows[0].id;
                    if (plan.referral_bonus_sessions > 0) {
                        await client.query(`UPDATE users SET sessions_left = sessions_left + $1, is_premium = TRUE WHERE id = $2`, [plan.referral_bonus_sessions, referrerId]);
                        await client.query(`UPDATE users SET sessions_left = sessions_left + $1 WHERE id = $2`, [plan.referral_bonus_sessions, userId]);
                    }
                    await client.query(`UPDATE referrals SET reward_given = TRUE, status = 'completed' WHERE id = $1`, [refId]);
                }
            }

            await client.query('COMMIT');
            console.log(`[PAYMENT-CALLBACK] Payment verified for user ${userId}, plan ${planId}`);
            return res.redirect(`${frontendUrl}/prime?payment=success`);

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('[PAYMENT-CALLBACK] Error:', error);
            return res.redirect(`${frontendUrl}/prime?payment=failed&reason=server_error`);
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('[PAYMENT-CALLBACK] Fatal error:', error);
        return res.redirect(`${frontendUrl}/prime?payment=failed&reason=server_error`);
    }
});

module.exports = router;

