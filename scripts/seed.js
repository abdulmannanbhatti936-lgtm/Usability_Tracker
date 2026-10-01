#!/usr/bin/env node
/**
 * Seed script — generates realistic fake usage data for the demo site.
 * Usage: node scripts/seed.js [--count 2000]
 */
'use strict';

const db = require('../server/db');

const SITE_KEY = 'demo_site_key_123';
const site = db.prepare('SELECT * FROM sites WHERE site_key=?').get(SITE_KEY);
if (!site) { console.error('Demo site not found in DB. Start the server first.'); process.exit(1); }

const args = process.argv.slice(2);
const COUNT = parseInt((args.find((a) => a.startsWith('--count')) || '--count=2000').split('=')[1], 10) || 2000;
const DAYS = 30;
const DAY = 864e5;

const PATHS = [
    '/demo/index.html', '/demo/pricing.html', '/demo/index.html', '/demo/index.html',
];
const DEVICES = ['desktop', 'desktop', 'desktop', 'tablet', 'mobile'];
const BROWSERS = ['Chrome', 'Firefox', 'Safari', 'Edge', 'Chrome', 'Chrome'];
const OSS = ['Windows', 'Windows', 'macOS', 'Android', 'iOS', 'Linux'];
const REFERRERS = ['', 'https://google.com', 'https://twitter.com', '', '', 'https://github.com'];
const SELECTORS = [
    'button#cta', 'nav > a:nth-of-type(2)', '.card:nth-of-type(1)',
    '.card:nth-of-type(2)', 'button.btn', '.hero h1',
];
const ENTRY_PATHS = ['/demo/index.html', '/demo/pricing.html', '/demo/index.html'];

function uid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min, max) { return Math.random() * (max - min) + min; }

const insSession = db.prepare(`
INSERT OR IGNORE INTO sessions
  (id, site_id, visitor_id, device_type, browser, os, screen_w, screen_h, viewport_w, viewport_h,
   language, referrer, entry_path, started_at, last_seen_at, page_count, event_count, is_new_visitor)
VALUES
  (@id, @site_id, @visitor_id, @device_type, @browser, @os, @screen_w, @screen_h, @viewport_w, @viewport_h,
   @language, @referrer, @entry_path, @started_at, @last_seen_at, @page_count, @event_count, @is_new_visitor)`);

const insPV = db.prepare(`
INSERT OR IGNORE INTO pageviews
  (id, session_id, site_id, path, title, device_type, doc_w, doc_h,
   started_at, duration_ms, active_ms, max_scroll_pct, load_time_ms)
VALUES
  (@id, @session_id, @site_id, @path, @title, @device_type, @doc_w, @doc_h,
   @started_at, @duration_ms, @active_ms, @max_scroll_pct, @load_time_ms)`);

const insEvent = db.prepare(`
INSERT INTO events
  (site_id, session_id, pageview_id, type, ts, path, device_type, x_pct, y, selector, tag, text, extra)
VALUES
  (@site_id, @session_id, @pageview_id, @type, @ts, @path, @device_type, @x_pct, @y, @selector, @tag, @text, @extra)`);

const TITLES = {
    '/demo/index.html': 'Demo Store',
    '/demo/pricing.html': 'Pricing',
};

let totalSessions = 0, totalEvents = 0;

const seed = db.transaction(() => {
    const now = Date.now();

    // Generate visitor pool (some are repeat visitors)
    const visitors = Array.from({ length: Math.round(COUNT * 0.7) }, () => uid());

    for (let i = 0; i < COUNT; i++) {
        const sessionId = uid();
        const visitorId = pick(visitors);
        const device = pick(DEVICES);
        const browser = pick(BROWSERS);
        const os = pick(OSS);
        const referrer = pick(REFERRERS);
        const entryPath = pick(ENTRY_PATHS);

        // Random time in past 30 days
        const sessionStart = now - randInt(0, DAYS) * DAY - randInt(0, DAY);
        const sessionDuration = randInt(5000, 15 * 60 * 1000);

        const screenW = device === 'desktop' ? pick([1920, 1440, 1366]) : device === 'tablet' ? pick([1024, 768]) : pick([375, 390, 414]);
        const screenH = device === 'desktop' ? 1080 : device === 'tablet' ? 1366 : 844;
        const viewportW = screenW - randInt(0, 50);
        const viewportH = screenH - randInt(100, 200);

        // Check if returning visitor
        const priorSessions = db.prepare('SELECT COUNT(*) c FROM sessions WHERE site_id=? AND visitor_id=?').get(site.id, visitorId);
        const isNew = priorSessions.c === 0 ? 1 : 0;

        insSession.run({
            id: sessionId, site_id: site.id, visitor_id: visitorId, device_type: device,
            browser, os, screen_w: screenW, screen_h: screenH, viewport_w: viewportW, viewport_h: viewportH,
            language: 'en-US', referrer, entry_path: entryPath,
            started_at: sessionStart, last_seen_at: sessionStart + sessionDuration,
            page_count: randInt(1, 4), event_count: randInt(3, 30),
            is_new_visitor: isNew,
        });

        // Generate 1-3 pageviews per session
        const numPages = randInt(1, 3);
        let pvStart = sessionStart;
        for (let p = 0; p < numPages; p++) {
            const pvId = uid();
            const pagePath = p === 0 ? entryPath : pick(PATHS);
            const pvDuration = randInt(2000, 8 * 60 * 1000);
            const scrollDepth = randInt(10, 100);
            const loadTime = randInt(300, 4000);
            const docH = randInt(2000, 8000);

            insPV.run({
                id: pvId, session_id: sessionId, site_id: site.id,
                path: pagePath, title: TITLES[pagePath] || pagePath,
                device_type: device, doc_w: viewportW, doc_h: docH,
                started_at: pvStart, duration_ms: pvDuration,
                active_ms: randInt(pvDuration * 0.3, pvDuration * 0.8),
                max_scroll_pct: scrollDepth, load_time_ms: loadTime,
            });

            // Generate events for this pageview
            const numClicks = randInt(0, 12);
            const hasRage = Math.random() < 0.08; // 8% have rage click sessions
            const hasError = Math.random() < 0.05; // 5% trigger errors

            for (let c = 0; c < numClicks; c++) {
                const ts = pvStart + randInt(500, pvDuration);
                const sel = pick(SELECTORS);
                const xPct = Math.max(0, Math.min(1, randFloat(0.1, 0.9)));
                const yCoord = randInt(100, Math.min(docH, 3000));

                insEvent.run({
                    site_id: site.id, session_id: sessionId, pageview_id: pvId,
                    type: 'click', ts, path: pagePath, device_type: device,
                    x_pct: parseFloat(xPct.toFixed(4)), y: yCoord,
                    selector: sel, tag: sel.split('#')[0] || 'div',
                    text: 'Click me', extra: null,
                });
                totalEvents++;
            }

            if (hasRage) {
                const ts = pvStart + randInt(500, pvDuration);
                const sel = 'button#fake';
                const xPct = randFloat(0.55, 0.65);
                const y = randInt(280, 320);
                for (let r = 0; r < 3; r++) {
                    insEvent.run({
                        site_id: site.id, session_id: sessionId, pageview_id: pvId,
                        type: r === 0 ? 'rage_click' : 'click', ts: ts + r * 200,
                        path: pagePath, device_type: device,
                        x_pct: parseFloat(xPct.toFixed(4)), y,
                        selector: sel, tag: 'button', text: 'Broken button', extra: null,
                    });
                    totalEvents++;
                }
                // Also add dead click
                if (Math.random() < 0.5) {
                    insEvent.run({
                        site_id: site.id, session_id: sessionId, pageview_id: pvId,
                        type: 'dead_click', ts: ts + 800, path: pagePath, device_type: device,
                        x_pct: parseFloat(xPct.toFixed(4)), y,
                        selector: sel, tag: 'button', text: 'Broken button', extra: null,
                    });
                    totalEvents++;
                }
            }

            if (hasError) {
                insEvent.run({
                    site_id: site.id, session_id: sessionId, pageview_id: pvId,
                    type: 'error', ts: pvStart + randInt(500, pvDuration),
                    path: pagePath, device_type: device,
                    x_pct: null, y: null,
                    selector: '', tag: '', text: 'undefinedFunction is not defined @index.html:100', extra: null,
                });
                totalEvents++;
            }

            // Mouse moves
            const numMoves = randInt(5, 30);
            for (let m = 0; m < numMoves; m++) {
                insEvent.run({
                    site_id: site.id, session_id: sessionId, pageview_id: pvId,
                    type: 'move', ts: pvStart + randInt(100, pvDuration),
                    path: pagePath, device_type: device,
                    x_pct: parseFloat(randFloat(0.05, 0.95).toFixed(4)), y: randInt(0, Math.min(docH, 5000)),
                    selector: '', tag: '', text: '', extra: null,
                });
                totalEvents++;
            }

            // Form interaction on contact section
            if (pagePath === '/demo/index.html' && Math.random() < 0.15) {
                const fields = ['name', 'email', 'message'];
                for (const field of fields) {
                    insEvent.run({
                        site_id: site.id, session_id: sessionId, pageview_id: pvId,
                        type: 'form_field', ts: pvStart + randInt(30000, pvDuration),
                        path: pagePath, device_type: device,
                        x_pct: null, y: null,
                        selector: `input[name="${field}"]`, tag: 'input', text: field,
                        extra: JSON.stringify({ type: 'text', ms: randInt(2000, 15000), changed: 1 }),
                    });
                    totalEvents++;
                }
                if (Math.random() < 0.7) {
                    insEvent.run({
                        site_id: site.id, session_id: sessionId, pageview_id: pvId,
                        type: 'form_submit', ts: pvStart + randInt(45000, pvDuration),
                        path: pagePath, device_type: device,
                        x_pct: null, y: null,
                        selector: 'form', tag: 'form', text: 'form', extra: null,
                    });
                    totalEvents++;
                }
            }

            pvStart += pvDuration + randInt(1000, 10000);
        }

        totalSessions++;
        if (totalSessions % 100 === 0) process.stdout.write(`\r  Seeded ${totalSessions}/${COUNT} sessions...`);
    }
});

console.log(`\n🌱 Seeding ${COUNT} sessions over ${DAYS} days...`);
const t0 = Date.now();
seed();
console.log(`\n✅ Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`   Sessions: ${totalSessions}`);
console.log(`   Events:   ${totalEvents}`);
console.log(`\n🔥 Open http://localhost:4000/dashboard/ to see the data!`);
