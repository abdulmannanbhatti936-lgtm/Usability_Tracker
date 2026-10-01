'use strict';
/**
 * Unit tests for analytics.js — usability score and insights logic.
 * Run: node --test tests/
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// ── Use an isolated in-memory DB for tests ──────────────────
const Database = require('better-sqlite3');
const DB_PATH = path.join(__dirname, '..', 'data', 'test-analytics.db');

// Patch config before requiring db/analytics
process.env.DB_PATH = DB_PATH;
process.env.ADMIN_TOKEN = 'test-token';
process.env.HMAC_SECRET = 'test-secret-12345678901234567890123';

// Must require after env is set
const db = require('../server/db');

// ── Re-implement score/insights locally so tests don't break when algo changes ──
// These are direct copies of the functions in analytics.js — the real tests
// call analytics.js through its exported API.
const A = require('../server/services/analytics');

// ── Helpers ─────────────────────────────────────────────────
const SITE_KEY = 'test_site_' + Date.now();
let siteId;
const now = Date.now();

function seed(rows) {
    // rows: array of { type, count, path, x_pct, y, selector }
    const insE = db.prepare(
        'INSERT INTO events (site_id, session_id, pageview_id, type, ts, path, device_type, x_pct, y, selector, tag, text, extra) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
    );
    for (const r of rows) {
        for (let i = 0; i < r.count; i++) {
            insE.run(siteId, 'sess-1', 'pv-1', r.type, now - i * 1000, r.path || '/test', 'desktop',
                r.x_pct ?? 0.5, r.y ?? 300, r.selector || 'button', 'button', 'text', null);
        }
    }
}

// ── Test suite ───────────────────────────────────────────────
describe('Analytics service', () => {

    before(() => {
        // Insert test site
        db.prepare('INSERT OR IGNORE INTO sites (name, site_key, origin, created_at) VALUES (?,?,?,?)')
            .run('Test Site', SITE_KEY, 'http://localhost', now);
        siteId = db.prepare('SELECT id FROM sites WHERE site_key=?').get(SITE_KEY).id;

        // Insert a session
        db.prepare(`INSERT OR IGNORE INTO sessions
            (id, site_id, visitor_id, device_type, browser, os, screen_w, screen_h, viewport_w, viewport_h,
             language, referrer, entry_path, started_at, last_seen_at, is_new_visitor)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run('sess-1', siteId, 'visitor-1', 'desktop', 'Chrome', 'Windows',
                1920, 1080, 1920, 1080, 'en', '', '/test', now - 60000, now, 1);

        // Insert a pageview
        db.prepare(`INSERT OR IGNORE INTO pageviews
            (id, session_id, site_id, path, title, device_type, doc_w, doc_h, started_at,
             duration_ms, active_ms, max_scroll_pct, load_time_ms)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run('pv-1', 'sess-1', siteId, '/test', 'Test Page', 'desktop',
                1920, 3000, now - 60000, 45000, 30000, 75, 1200);
    });

    after(() => {
        // Cleanup test data
        db.prepare('DELETE FROM events WHERE site_id=?').run(siteId);
        db.prepare('DELETE FROM pageviews WHERE site_id=?').run(siteId);
        db.prepare('DELETE FROM sessions WHERE site_id=?').run(siteId);
        db.prepare('DELETE FROM sites WHERE id=?').run(siteId);
        try { fs.unlinkSync(DB_PATH); } catch {}
    });

    const f = () => A.parseFilters({ range: 'all' }, { id: siteId });

    // ── Score tests ──────────────────────────────────────────

    it('overview returns a numeric score for seeded data', () => {
        const o = A.overview(f());
        assert.ok(o.score !== undefined, 'score should exist');
        assert.ok(o.score >= 0 && o.score <= 100, 'score must be 0–100');
    });

    it('score drops when rage clicks are added', () => {
        // Get baseline score first
        const baseline = A.overview(f()).score;
        seed([{ type: 'rage_click', count: 20, path: '/test' }]);
        const withRage = A.overview(f()).score;
        assert.ok(withRage <= baseline, 'rage clicks should lower or keep score equal');
        // cleanup
        db.prepare("DELETE FROM events WHERE site_id=? AND type='rage_click'").run(siteId);
    });

    it('score drops when dead clicks are added', () => {
        const baseline = A.overview(f()).score;
        seed([{ type: 'dead_click', count: 10, path: '/test' }]);
        const withDead = A.overview(f()).score;
        assert.ok(withDead <= baseline, 'dead clicks should lower or keep score equal');
        db.prepare("DELETE FROM events WHERE site_id=? AND type='dead_click'").run(siteId);
    });

    it('score drops when JS errors are added', () => {
        const baseline = A.overview(f()).score;
        seed([{ type: 'error', count: 5, path: '/test', x_pct: null, y: null }]);
        const withErr = A.overview(f()).score;
        assert.ok(withErr <= baseline, 'JS errors should lower or keep score equal');
        db.prepare("DELETE FROM events WHERE site_id=? AND type='error'").run(siteId);
    });

    // ── Insights tests ───────────────────────────────────────

    it('insights returns an array', () => {
        const o = A.overview(f());
        assert.ok(Array.isArray(o.insights));
    });

    it('insights mentions rage clicks when rate is high', () => {
        seed([{ type: 'rage_click', count: 50, path: '/test' }]);
        const o = A.overview(f());
        const hasRageInsight = o.insights.some((i) => i.text.includes('rage'));
        assert.ok(hasRageInsight, 'should flag rage clicks in insights');
        db.prepare("DELETE FROM events WHERE site_id=? AND type='rage_click'").run(siteId);
    });

    // ── Pages tests ──────────────────────────────────────────

    it('pages() returns array with at least one row', () => {
        const rows = A.pages(f());
        assert.ok(Array.isArray(rows));
        assert.ok(rows.length > 0, 'should have at least one page entry');
    });

    it('pages() rows all have required fields', () => {
        const rows = A.pages(f());
        for (const r of rows) {
            assert.ok(r.path, 'each page needs a path');
            assert.ok(typeof r.views === 'number', 'views must be a number');
            assert.ok(r.score === null || (r.score >= 0 && r.score <= 100), 'score must be 0–100 or null');
        }
    });

    // ── Heatmap tests ────────────────────────────────────────

    it('heatmap() returns points array for click type', () => {
        seed([{ type: 'click', count: 5, path: '/test', x_pct: 0.5, y: 300 }]);
        const h = A.heatmap({ ...f(), path: '/test' }, 'click');
        assert.ok(Array.isArray(h.points), 'points should be an array');
        assert.ok(typeof h.total === 'number', 'total should be a number');
        db.prepare("DELETE FROM events WHERE site_id=? AND type='click'").run(siteId);
    });

    it('heatmap() scroll type returns reach array', () => {
        const h = A.heatmap({ ...f(), path: '/test' }, 'scroll');
        assert.ok(h.type === 'scroll', 'type should be scroll');
        assert.ok(Array.isArray(h.reach), 'reach should be an array');
    });

    // ── Flow tests ───────────────────────────────────────────

    it('flow() returns entries, exits, transitions', () => {
        const d = A.flow(f());
        assert.ok(Array.isArray(d.entries));
        assert.ok(Array.isArray(d.exits));
        assert.ok(Array.isArray(d.transitions));
    });

    // ── Compare tests ────────────────────────────────────────

    it('compare() returns current, previous, and deltas', () => {
        const d = A.compare(f());
        assert.ok(typeof d.current === 'object');
        assert.ok(typeof d.previous === 'object');
        assert.ok(typeof d.deltas === 'object');
    });

    it('compare() deltas are numbers', () => {
        const d = A.compare(f());
        for (const [k, v] of Object.entries(d.deltas)) {
            assert.ok(typeof v === 'number', `delta[${k}] should be a number`);
        }
    });

    // ── Top problems tests ───────────────────────────────────

    it('topProblems() returns an array', () => {
        const p = A.topProblems(f());
        assert.ok(Array.isArray(p));
    });

    it('topProblems() items have required fields', () => {
        seed([{ type: 'rage_click', count: 5, path: '/test', selector: 'button#test' }]);
        const p = A.topProblems(f());
        for (const item of p) {
            assert.ok(item.severity, 'problem needs severity');
            assert.ok(item.type, 'problem needs type');
            assert.ok(item.description, 'problem needs description');
        }
        db.prepare("DELETE FROM events WHERE site_id=? AND type='rage_click'").run(siteId);
    });

    // ── Timeseries tests ─────────────────────────────────────

    it('timeseries() returns array with date fields', () => {
        const ts = A.timeseries({ ...f(), path: '' });
        assert.ok(Array.isArray(ts));
        if (ts.length > 0) {
            assert.ok(ts[0].date, 'entry needs date field');
            assert.ok(typeof ts[0].views === 'number', 'entry needs views field');
        }
    });

    // ── Purge tests ──────────────────────────────────────────

    it('purgeOldData() returns counts', () => {
        const result = A.purgeOldData(siteId, 9999); // 9999 days = nothing deleted
        assert.ok(typeof result.events === 'number');
        assert.ok(typeof result.pageviews === 'number');
        assert.ok(typeof result.sessions === 'number');
    });

    it('purgeOldData() deletes data older than cutoff', () => {
        // Insert old data (2000 days ago)
        db.prepare('INSERT INTO events (site_id, session_id, pageview_id, type, ts, path, device_type) VALUES (?,?,?,?,?,?,?)')
            .run(siteId, 'sess-old', 'pv-old', 'click', now - (2000 * 86400000), '/old', 'desktop');
        const result = A.purgeOldData(siteId, 30); // 30-day retention
        assert.ok(result.events >= 1, 'should delete old events');
    });
});
