const jwt = require('jsonwebtoken');
const { HMAC_SECRET } = require('../config');

// Use HMAC_SECRET as JWT secret for simplicity
const JWT_SECRET = HMAC_SECRET || 'fallback-jwt-secret';

module.exports = function auth(req, res, next) {
    const authHeader = req.get('Authorization');
    const oldToken = req.get('x-admin-token'); // fallback for heatmap overlay iframe? No, heatmap needs to pass JWT or HMAC.
    
    // We expect "Bearer <token>"
    const token = authHeader ? authHeader.replace('Bearer ', '') : oldToken;
    if (!token) return res.status(401).json({ error: 'unauthorized' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // { id, email }
        next();
    } catch (e) {
        return res.status(401).json({ error: 'unauthorized: invalid token' });
    }
};