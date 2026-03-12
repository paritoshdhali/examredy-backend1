const axios = require('axios');

async function check() {
    try {
        const { data: html } = await axios.get('https://examredyv1.vercel.app/');
        const str = html.toString();
        const match = str.match(/src="(\/assets\/index-[^"]+\.js)"/);

        if (match) {
            const url = 'https://examredyv1.vercel.app' + match[1];
            console.log('Fetching bundle:', url);
            const { data: js } = await axios.get(url);

            const hasLog = js.includes('[Footer] Loaded settings');
            const hasUndefinedCheck = js.includes(`trim()!==''`);

            console.log('Has my console.log?', hasLog);
            console.log('Has my trim() checks?', hasUndefinedCheck);

            if (!hasLog || !hasUndefinedCheck) {
                console.log('=> The Vercel site is running OLD code! Deployment failed or is stuck.');
            } else {
                console.log('=> The Vercel site is running NEW code!');
            }
        } else {
            console.log('No JS bundle found in HTML', str.substring(0, 500));
        }
    } catch (e) {
        console.error('Error:', e.message);
    }
}

check();
