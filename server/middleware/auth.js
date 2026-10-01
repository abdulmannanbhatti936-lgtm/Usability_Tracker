const crypto = require('crypto');
const { ADMIN_TOKEN } = require('../config');

// Login rate limiter (per IP, 15-minute window)
const loginAttempts = new Map();
setInterval(() => loginAttempts.clear(), 15 * 60 * 1000).unref();

module.exports = function auth(req, res, next) {
    const ip = req.ip || 'unknown';
    const attempts = (loginAttempts.get(ip) || 0);

    // Rate limit: max 10 failed attempts per 15 min per IP
    if (attempts >= 10) {
        return res.status(429).json({ error: 'too many failed login attempts, try again later' });
    }

    const t = Buffer.from(req.get('x-admin-token') || '');
    const a = Buffer.from(ADMIN_TOKEN);

    if (t.length === a.length && crypto.timingSafeEqual(t, a)) {
        // Success — reset counter
        loginAttempts.delete(ip);
        return next();
    }

    // Failed — increment counter
    loginAttempts.set(ip, attempts + 1);
    res.status(401).json({ error: 'unauthorized' });
};