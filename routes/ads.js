const express = require('express');
const router = express.Router();
const { query } = require('../db');

// @route   GET /api/ads
// @desc    Get active ads for a specific platform (web/app)
// @access  Public
router.get('/', async (req, res) => {
    const { platform } = req.query;

    if (!platform || !['web', 'app'].includes(platform)) {
        return res.status(400).json({ error: 'Valid platform (web or app) is required' });
    }

    try {
        const result = await query(
            'SELECT ad_type, ad_unit_id FROM ads_settings WHERE platform = $1 AND is_active = TRUE ORDER BY ad_type ASC',
            [platform]
        );

        // Transform into a key-value object for easier frontend consumption
        const ads = {};
        result.rows.forEach(row => {
            ads[row.ad_type] = row.ad_unit_id;
        });

        res.json({ success: true, platform, ads });
    } catch (e) {
        console.error(`[ADS-FETCH-ERROR] Platform ${platform}:`, e.message);
        res.status(500).json({ error: 'Failed to fetch ads configuration' });
    }
});

module.exports = router;
