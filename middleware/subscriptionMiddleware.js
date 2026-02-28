const subscriptionCheck = (req, res, next) => {
    // Access granted if:
    // 1. User is an Admin
    // 2. User has sessions_left > 0
    // 3. User has sessions_left === -1 (Unlimited)
    const isPremium = req.user && (
        req.user.role === 'admin' ||
        req.user.sessions_left > 0 ||
        req.user.sessions_left === -1
    );

    if (isPremium) {
        req.isPremium = true;
        next();
    } else {
        req.isPremium = false;
        next();
    }
};

module.exports = { subscriptionCheck };
