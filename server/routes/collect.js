const express = require('express');
const db = require('../db');
const router = express.Router();

const TYPES = new Set(['click', 'rage_click', 'dead_click', 'move', 'error', 'form_field', 'form_submit', 'custom']);
const DEVICES = new Set(['desktop', 'tablet', 'mobile']);

const str = (v, max = 200) => (v == null ? '' : String(v).slice(0, max));
const int = (v, d = 0) => { v = Number(v); return Number.isFinite(v) ? Math.round(v) : d; };
const flt = (v) => { v = Number(v); return Number.isFinite(v) ? v : null; };

// Tiny in-memory rate limiter (per IP / minute)
const hits = new Map();
setInterval(() => hits.clear(), 60000).unref();

router.use('/collect', (req, res, next) => {
    const c = (hits.get(req.ip) || 0) + 1;
    hits.set(req.ip, c);
    if (c > 300) return res.status(429).end();
    next();
});

const getSite = db.prepare('SELECT * FROM sites WHERE site_key = ?');
const getVisitor = db.prepare('SELECT COUNT(*) c FROM sessions WHERE site_id = ? AND visitor_id = ? AND id != ?');

const upsertSession = db.prepare(`
INSERT INTO sessions (id, site_id, visitor_id, device_type, browser, os, screen_w, screen_h, viewport_w, viewport_h,
  language, referrer, entry_path, started_at, last_seen_at, is_new_visitor)
VALUES (@id, @site_id, @visitor_id, @device_type, @browser, @os, @screen_w, @screen_h, @viewport_w, @viewport_h,
  @language, @referrer, @entry_path, @started_at, @last_seen_at, @is_new_visitor)
ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at`);

const upsertPV = db.prepare(`
INSERT INTO pageviews (id, session_id, site_id, path, title, device_type, doc_w, doc_h, started_at,
  duration_ms, active_ms, max_scroll_pct, load_time_ms)
VALUES (@id, @session_id, @site_id, @path, @title, @device_type, @doc_w, @doc_h, @started_at,
  @duration_ms, @active_ms, @max_scroll_pct, @load_time_ms)
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  doc_w = excluded.doc_w,
  doc_h = excluded.doc_h,
  duration_ms = MAX(duration_ms, excluded.duration_ms),
  active_ms = MAX(active_ms, excluded.active_ms),
  max_scroll_pct = MAX(max_scroll_pct, excluded.max_scroll_pct),
  load_time_ms = CASE WHEN excluded.load_time_ms > 0 THEN excluded.load_time_ms ELSE load_time_ms END`);

const insEvent = db.prepare(`
INSERT INTO events (site_id, session_id, pageview_id, type, ts, path, device_type, x_pct, y, selector, tag, text, extra)
VALUES (@site_id, @session_id, @pageview_id, @type, @ts, @path, @device_type, @x_pct, @y, @selector, @tag, @text, @extra)`);

const updCounts = db.prepare(`
UPDATE sessions SET
  page_count = (SELECT COUNT(*) FROM pageviews WHERE session_id = @id),
  event_count = event_count + @n
WHERE id = @id`);

const save = db.transaction((site, s, p, events) => {
    const now = Date.now();
    const device = DEVICES.has(s.device) ? s.device : 'desktop';
    const pvStart = Math.abs(int(p.start, now) - now) > 864e5 ? now : int(p.start, now);

    // Determine if new visitor (no prior sessions with this visitor_id for this site)
    const vid = str(s.vid, 64);
    const sid = str(s.id, 64);
    let isNew = 1;
    if (vid) {
        const prior = getVisitor.get(site.id, vid, sid);
        isNew = prior && prior.c > 0 ? 0 : 1;
    }

    upsertSession.run({
        id: sid, site_id: site.id, visitor_id: vid, device_type: device,
        browser: str(s.browser, 40), os: str(s.os, 40),
        screen_w: int(s.sw), screen_h: int(s.sh), viewport_w: int(s.vw), viewport_h: int(s.vh),
        language: str(s.lang, 20), referrer: str(s.ref, 300), entry_path: str(p.path, 300),
        started_at: int(s.start, now), last_seen_at: now,
        is_new_visitor: isNew,
    });

    upsertPV.run({
        id: str(p.id, 64), session_id: sid, site_id: site.id, path: str(p.path, 300) || '/',
        title: str(p.title, 150), device_type: device, doc_w: int(p.dw), doc_h: int(p.dh),
        started_at: pvStart, duration_ms: int(p.dur), active_ms: int(p.active),
        max_scroll_pct: Math.min(100, int(p.scroll)), load_time_ms: int(p.load),
    });

    let n = 0;
    for (const e of events) {
        if (!e || !TYPES.has(e.t)) continue;
        const ts = Math.abs(int(e.ts, now) - now) > 864e5 ? now : int(e.ts, now);
        // Clamp x_pct to [0,1], y to non-negative
        const xPct = flt(e.x);
        const xClamped = xPct != null ? Math.max(0, Math.min(1, xPct)) : null;
        const yClamped = e.y == null ? null : Math.max(0, int(e.y));
        insEvent.run({
            site_id: site.id, session_id: sid, pageview_id: str(p.id, 64), type: e.t, ts,
            path: str(p.path, 300) || '/', device_type: device,
            x_pct: xClamped, y: yClamped,
            selector: str(e.sel, 300), tag: str(e.tag, 20), text: str(e.txt, 200),
            extra: e.ex ? JSON.stringify(e.ex).slice(0, 500) : null,
        });
        n++;
    }
    updCounts.run({ id: sid, n });
});

router.post('/collect', (req, res) => {
    const b = req.body || {};
    const site = getSite.get(str(b.k, 100));
    if (!site) return res.status(401).json({ error: 'invalid site key' });

    // Optional: validate origin if site.origin is set
    if (site.origin) {
        const reqOrigin = req.get('origin') || req.get('referer') || '';
        if (reqOrigin && !reqOrigin.startsWith(site.origin)) {
            // Allow localhost in dev
            if (!reqOrigin.includes('localhost') && !reqOrigin.includes('127.0.0.1')) {
                return res.status(403).json({ error: 'origin not allowed' });
            }
        }
    }

    const s = b.s || {}, p = b.p || {};
    if (!s.id || !p.id) return res.status(400).json({ error: 'bad payload' });

    try {
        save(site, s, p, Array.isArray(b.e) ? b.e.slice(0, 500) : []);
        res.status(204).end();
    } catch (e) {
        console.error('collect error', e.message);
        res.status(500).end();
    }
});

module.exports = router;