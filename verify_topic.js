
const { query } = require('./db');

const testResolve = async () => {
    const body = {
        categoryId: 2,
        universityId: 11,
        semesterId: 11,
        subjectId: 2287,
        language: 'English'
    };

    let topicParts = [];

    // Category
    if (body.categoryId) {
        const cat = await query('SELECT name FROM categories WHERE id = $1', [body.categoryId]);
        if (cat.rows[0]) topicParts.push(cat.rows[0].name);
    }
    // University
    if (body.universityId) {
        const uni = await query('SELECT name FROM universities WHERE id = $1', [body.universityId]);
        if (uni.rows[0]) topicParts.push(uni.rows[0].name);
    }
    // Semester
    if (body.semesterId) {
        const sem = await query('SELECT name FROM semesters WHERE id = $1', [body.semesterId]);
        if (sem.rows[0]) topicParts.push(sem.rows[0].name);
    }
    // Subject
    if (body.subjectId) {
        const sub = await query('SELECT name FROM subjects WHERE id = $1', [body.subjectId]);
        if (sub.rows[0]) topicParts.push(sub.rows[0].name);
    }

    const topic = topicParts.length > 0 ? topicParts.join(' ') : 'General Knowledge';
    console.log('Resolved Topic:', topic);
    
    if (topic.includes('First Semester')) {
        console.log('✅ Semester resolution working correctly.');
    } else {
        console.log('❌ Semester resolution failed!');
    }
};

testResolve().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
