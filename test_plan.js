const axios = require('axios');

async function testPlans() {
    const API_URL = 'https://examredy-backend1-production.up.railway.app/api';

    // Login to get token
    const loginRes = await axios.post(`${API_URL}/admin/login`, {
        email: 'admin@examredy.in',
        password: 'Admin@123'
    });

    const token = loginRes.data.token;
    console.log('Got token:', token ? 'Yes' : 'No');

    // Get plans
    const plansRes = await axios.get(`${API_URL}/admin/plans`, {
        headers: { Authorization: `Bearer ${token}` }
    });

    console.log('Current Plans:', plansRes.data);

    if (plansRes.data.length > 0) {
        const planToEdit = plansRes.data[0];
        console.log(`\nAttempting to edit plan ${planToEdit.id}...`);

        try {
            const updateRes = await axios.put(`${API_URL}/admin/plans/${planToEdit.id}`, {
                name: 'TEST PLAN',
                duration_hours: 99,
                price: 999.99,
                is_active: true
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            console.log('Update Response:', updateRes.data);

            // Re-fetch to verify
            const verifyRes = await axios.get(`${API_URL}/admin/plans`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            console.log('\nVerified Plans:', verifyRes.data);

        } catch (e) {
            console.error('Update Failed:', e.response?.data || e.message);
        }
    }
}

testPlans();
