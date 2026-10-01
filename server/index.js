const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { PORT, ADMIN_TOKEN, RETENTION_DAYS } = require('./config');
const db = require('./db');

const app = express();
app.set('trust proxy', true);

/* ---------- Security headers ---------- */
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=()');
    next();
});

/* ---------- CORS: collect is open, admin is locked ---------- */
const collectCors = cors({
    origin: '*',
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
});

const adminCors = cors({
    origin: process.env.ADMIN_ORIGIN || true, // Set ADMIN_ORIGIN in prod
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-admin-token'],
});

app.use(express.json({ limit: '300kb', type: ['application/json', 'text/plain'] }));

/* ---------- Static files ---------- */
app.use(express.static(path.join(__dirname, '..', 'public'), {
    setHeaders: (res, filePath) => {
        // Cache tracker.js for 1 hour, dashboard assets for 1 day
        if (filePath.endsWith('tracker.js') || filePath.endsWith('tracker.min.js')) {
            res.setHeader('Cache-Control', 'public, max-age=3600');
        }
    }
}));

/* ---------- Routes ---------- */
app.use('/api/collect', collectCors);
app.use('/api/admin', adminCors);
app.use('/api', require('./routes/collect'));
app.use('/api/admin', require('./routes/admin'));

app.get('/', (req, res) => res.redirect('/dashboard/'));
app.get('/dashboard', (req, res) => res.redirect('/dashboard/'));

/* ---------- Global error handler ---------- */
app.use((err, req, res, next) => {
    console.error('[error]', err.message);
    res.status(400).json({ error: 'bad request' });
});

/* ---------- Daily retention cleanup cron ---------- */
function runRetentionCleanup() {
    const sites = db.prepare('SELECT id, name FROM sites').all();
    let totalDeleted = 0;
    for (const site of sites) {
        try {
            const { events, pageviews, sessions } = require('./services/analytics').purgeOldData(site.id, RETENTION_DAYS);
            totalDeleted += events + pageviews + sessions;
            if (events + pageviews + sessions > 0) {
                console.log(`[retention] ${site.name}: removed ${events} events, ${pageviews} pageviews, ${sessions} sessions older than ${RETENTION_DAYS} days`);
            }
        } catch (e) {
            console.error('[retention] cleanup error:', e.message);
        }
    }
    return totalDeleted;
}

// Run cleanup once at startup and then every 24 hours
setTimeout(runRetentionCleanup, 5000);
setInterval(runRetentionCleanup, 24 * 60 * 60 * 1000).unref();

/* ---------- Start server ---------- */
app.listen(PORT, () => {
    console.log(`\n🔥 Usability Tracker running on http://localhost:${PORT}`);
    console.log(`   Dashboard  : http://localhost:${PORT}/dashboard/`);
    console.log(`   Demo site  : http://localhost:${PORT}/demo/`);
    console.log(`   Retention  : ${RETENTION_DAYS} days`);
    if (ADMIN_TOKEN === 'admin123' || ADMIN_TOKEN === 'change-me-super-secret') {
        console.log('   ⚠️  Default ADMIN_TOKEN in use — change it in .env for production!');
    }
});