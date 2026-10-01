const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { HMAC_SECRET } = require('../config');

const router = express.Router();

const insUser = db.prepare('INSERT INTO users (email, password, created_at) VALUES (?, ?, ?)');
const getUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?');

// Use HMAC_SECRET as JWT secret for simplicity
const JWT_SECRET = HMAC_SECRET || 'fallback-jwt-secret';

router.post('/signup', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password || password.length < 6) {
        return res.status(400).json({ error: 'Valid email and 6+ char password required' });
    }

    try {
        const existing = getUserByEmail.get(email);
        if (existing) {
            return res.status(400).json({ error: 'Email already in use' });
        }

        const hash = await bcrypt.hash(password, 10);
        const info = insUser.run(email, hash, Date.now());

        const token = jwt.sign({ id: info.lastInsertRowid, email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: info.lastInsertRowid, email } });
    } catch (e) {
        console.error('Signup error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    try {
        const user = getUserByEmail.get(email);
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user.id, email: user.email } });
    } catch (e) {
        console.error('Login error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
