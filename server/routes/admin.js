const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const auth = require('../middleware/auth');
const A = require('../services/analytics');
const { HMAC_SECRET, RETENTION_DAYS } = require('../config');

const router = express.Router();
router.use(auth);

const getSite = db.prepare('SELECT * FROM sites WHERE site_key = ?');

function withSite(handler) {
    return (req, res) => {
        const site = getSite.get(req.query.site || '');
        if (!site) return res.status(404).json({ error: 'site not found' });
        try {
            const out = handler(site, A.parseFilters(req.query, site), req);
            if (out === null) return res.status(404).json({ error: 'not found' });
            res.json(out);
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: e.message });
        }
    };
}

/* ---------- Basic routes ---------- */
router.get('/ping', (req, res) => res.json({ ok: true }));

router.get('/sites', (req, res) => {
    res.json(db.prepare('SELECT id, name, site_key, origin, created_at FROM sites ORDER BY id').all());
});

router.post('/sites', (req, res) => {
    const name = String(req.body.name || '').slice(0, 80).trim();
    const origin = String(req.body.origin || '').slice(0, 200).trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const key = 'site_' + crypto.randomBytes(12).toString('hex');
    db.prepare('INSERT INTO sites(name, site_key, origin, created_at) VALUES (?,?,?,?)').run(name, key, origin, Date.now());
    res.json({ name, site_key: key, origin });
});

/* ---------- Site key rotation ---------- */
router.post('/sites/:id/rotate-key', (req, res) => {
    const site = db.prepare('SELECT * FROM sites WHERE id=?').get(req.params.id);
    if (!site) return res.status(404).json({ error: 'site not found' });
    const newKey = 'site_' + crypto.randomBytes(12).toString('hex');
    db.prepare('UPDATE sites SET site_key=? WHERE id=?').run(newKey, site.id);
    // Update all existing data to use new key association (site_id stays same)
    res.json({ site_key: newKey, message: 'Key rotated. Update your embed scripts.' });
});

/* ---------- Short-lived heatmap tokens ---------- */
router.post('/heatmap-token', (req, res) => {
    const payload = JSON.stringify({ ts: Date.now(), ttl: 15 * 60 * 1000 });
    const sig = crypto.createHmac('sha256', HMAC_SECRET).update(payload).digest('hex');
    const token = Buffer.from(payload).toString('base64url') + '.' + sig;
    res.json({ token, expires_in: 900 });
});

router.get('/verify-heatmap-token', (req, res) => {
    const token = req.query.token || '';
    const [b64, sig] = token.split('.');
    if (!b64 || !sig) return res.status(401).json({ error: 'invalid token' });
    try {
        const payload = Buffer.from(b64, 'base64url').toString();
        const expectedSig = crypto.createHmac('sha256', HMAC_SECRET).update(payload).digest('hex');
        const sigBuf = Buffer.from(sig);
        const expBuf = Buffer.from(expectedSig);
        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
            return res.status(401).json({ error: 'invalid signature' });
        }
        const data = JSON.parse(payload);
        if (Date.now() - data.ts > data.ttl) return res.status(401).json({ error: 'token expired' });
        res.json({ ok: true });
    } catch {
        res.status(401).json({ error: 'invalid token' });
    }
});

/* ---------- Analytics routes ---------- */
router.get('/overview', withSite((s, f) => A.overview(f)));
router.get('/pages', withSite((s, f) => A.pages(f)));
router.get('/timeseries', withSite((s, f) => A.timeseries(f)));
router.get('/devices', withSite((s, f) => A.devices(f)));
router.get('/sessions', withSite((s, f) => A.sessions(f)));
router.get('/sessions/:id', withSite((s, f, req) => A.sessionDetail(req.params.id, s.id)));
router.get('/errors', withSite((s, f) => A.errors(f)));
router.get('/forms', withSite((s, f) => A.forms(f)));
router.get('/elements', withSite((s, f) => A.elements(f)));
router.get('/flow', withSite((s, f) => A.flow(f)));
router.get('/compare', withSite((s, f) => A.compare(f)));
router.get('/top-problems', withSite((s, f) => A.topProblems(f)));

router.get('/heatmap', withSite((s, f, req) => {
    if (!f.path) throw new Error('path is required');
    return A.heatmap(f, req.query.type || 'click');
}));

/* ---------- Export routes ---------- */
router.get('/export/:type', (req, res) => {
    const site = getSite.get(req.query.site || '');
    if (!site) return res.status(404).json({ error: 'site not found' });
    const f = A.parseFilters(req.query, site);
    const format = req.query.format || 'json';
    const type = req.params.type;

    try {
        const data = A.exportData(f, type);
        if (format === 'csv') {
            if (!data.length) return res.status(204).end();
            const keys = Object.keys(data[0]);
            const csv = [
                keys.join(','),
                ...data.map((row) => keys.map((k) => {
                    const v = row[k];
                    if (v == null) return '';
                    const s = String(v).replace(/"/g, '""');
                    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
                }).join(',')),
            ].join('\n');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${type}-export.csv"`);
            return res.send(csv);
        }
        res.json(data);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

/* ---------- Data management ---------- */
router.delete('/sites/:id/data', (req, res) => {
    const site = db.prepare('SELECT * FROM sites WHERE id=?').get(req.params.id);
    if (!site) return res.status(404).json({ error: 'site not found' });
    A.deleteSiteData(site.id);
    res.json({ ok: true, message: `All data for "${site.name}" deleted` });
});

router.post('/sites/:id/purge', (req, res) => {
    const site = db.prepare('SELECT * FROM sites WHERE id=?').get(req.params.id);
    if (!site) return res.status(404).json({ error: 'site not found' });
    const days = parseInt(req.body.days || RETENTION_DAYS, 10);
    const result = A.purgeOldData(site.id, days);
    res.json({ ok: true, deleted: result });
});

module.exports = router;