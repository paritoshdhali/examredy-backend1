const bcrypt = require('bcryptjs');

async function test() {
    const hash = '$2b$10$6ScBxzHSt71LLW8C30R36uGHI8KNISyrX6csT/rbd6FeKIJ.sXu5S';
    const p1 = 'admin123';
    const p2 = 'Admin@123';
    console.log('admin123 matches:', await bcrypt.compare(p1, hash));
    console.log('Admin@123 matches:', await bcrypt.compare(p2, hash));
}
test();
