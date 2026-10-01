const db = require('../db');

const DAY = 864e5;
const RANGES = { '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY, '90d': 90 * DAY };
const TYPE_MAP = { click: 'click', rage: 'rage_click', dead: 'dead_click', move: 'move' };

function parseFilters(q, site) {
    const range = q.range || '7d';
    return {
        siteId: site.id,
        range,
        from: range === 'all' ? 0 : Date.now() - (RANGES[range] || RANGES['7d']),
        device: ['desktop', 'tablet', 'mobile'].includes(q.device) ? q.device : 'all',
        path: q.path || '',
        // Segment filters
        visitor: q.visitor || 'all', // 'new' | 'returning' | 'all'
        browser: q.browser || '',
        os: q.os || '',
        referrer: q.referrer || '',
    };
}

/* Build WHERE clause with optional segment filters */
function where(f, o = {}) {
    const pre = o.pre || '';
    const ts = o.ts || 'ts';
    const usePath = o.path !== false;
    let sql = `${pre}site_id=? AND ${pre}${ts}>=?`;
    const params = [f.siteId, f.from];

    if (f.device !== 'all') { sql += ` AND ${pre}device_type=?`; params.push(f.device); }
    if (usePath && f.path) { sql += ` AND ${pre}path=?`; params.push(f.path); }
    return { sql, params };
}

/* Session-level where clause with segment filters */
function sessionWhere(f, pre = 's.') {
    let sql = `${pre}site_id=? AND ${pre}started_at>=?`;
    const params = [f.siteId, f.from];
    if (f.device !== 'all') { sql += ` AND ${pre}device_type=?`; params.push(f.device); }
    if (f.visitor === 'new') { sql += ` AND ${pre}is_new_visitor=1`; }
    if (f.visitor === 'returning') { sql += ` AND ${pre}is_new_visitor=0`; }
    if (f.browser) { sql += ` AND ${pre}browser=?`; params.push(f.browser); }
    if (f.os) { sql += ` AND ${pre}os=?`; params.push(f.os); }
    if (f.referrer) { sql += ` AND ${pre}referrer LIKE ?`; params.push('%' + f.referrer + '%'); }
    return { sql, params };
}

/* ---------- Usability score & insights ---------- */
function computeScore(o) {
    const rageP = Math.min(30, o.rage_rate * 150);
    const deadP = Math.min(20, o.dead_rate * 60);
    const errP = Math.min(20, o.error_rate * 200);
    const bounceP = Math.min(15, o.bounce_rate * 30);
    const scrollP = o.avg_scroll < 40 ? Math.min(10, (40 - o.avg_scroll) * 0.25) : 0;
    const loadP = o.avg_load > 3000 ? Math.min(10, (o.avg_load - 3000) / 500) : 0;
    return Math.max(0, Math.min(100, Math.round(100 - rageP - deadP - errP - bounceP - scrollP - loadP)));
}

const pc = (v) => Math.round(v * 100) + '%';

function insights(o) {
    const out = [];
    if (!o.views) return out;
    if (o.rage_rate >= 0.05) out.push({ level: 'bad', text: `${pc(o.rage_rate)} of visits had rage clicks (users are frustrated)` });
    if (o.dead_rate >= 0.1) out.push({ level: 'warn', text: `${pc(o.dead_rate)} of clicks on clickable-looking elements did nothing` });
    if (o.errors > 0) out.push({ level: 'bad', text: `${o.errors} JavaScript errors across ${o.error_views} visits` });
    if (o.avg_scroll < 40) out.push({ level: 'warn', text: `Low average scroll depth (${o.avg_scroll}%), content below the fold is missed` });
    if (o.bounce_rate >= 0.5) out.push({ level: 'warn', text: `High bounce rate (${pc(o.bounce_rate)})` });
    if (o.avg_load > 3000) out.push({ level: 'warn', text: `Slow load time (${(o.avg_load / 1000).toFixed(1)}s average)` });
    if (!out.length) out.push({ level: 'good', text: 'No major usability problems detected — looking great!' });
    return out;
}

function decorate(r) {
    ['clicks', 'dead_clicks', 'rage_clicks', 'rage_views', 'error_views', 'errors', 'bounces', 'sessions', 'views']
        .forEach((k) => { r[k] = r[k] || 0; });
    const o = {
        ...r,
        avg_duration: Math.round(r.avg_duration || 0),
        avg_active: Math.round(r.avg_active || 0),
        avg_scroll: Math.round(r.avg_scroll || 0),
        avg_load: Math.round(r.avg_load || 0),
    };
    o.rage_rate = o.views ? o.rage_views / o.views : 0;
    o.dead_rate = o.clicks ? o.dead_clicks / o.clicks : 0;
    o.error_rate = o.views ? o.error_views / o.views : 0;
    o.bounce_rate = o.views ? o.bounces / o.views : 0;
    o.score = o.views ? computeScore(o) : null;
    o.grade = o.score == null ? 'N/A'
        : o.score >= 85 ? 'Excellent'
        : o.score >= 70 ? 'Good'
        : o.score >= 50 ? 'Needs work'
        : 'Poor';
    o.insights = insights(o);
    return o;
}

function pageStats(f, group) {
    const w = where(f, { pre: 'pv.', ts: 'started_at', path: !group });
    const sql = `
  SELECT ${group ? 'pv.path AS path,' : ''}
    COUNT(*) views,
    COUNT(DISTINCT pv.session_id) sessions,
    AVG(pv.duration_ms) avg_duration,
    AVG(pv.active_ms) avg_active,
    AVG(pv.max_scroll_pct) avg_scroll,
    AVG(NULLIF(pv.load_time_ms, 0)) avg_load,
    SUM(IFNULL(e.clicks, 0)) clicks,
    SUM(IFNULL(e.dead, 0)) dead_clicks,
    SUM(IFNULL(e.rage, 0)) rage_clicks,
    SUM(CASE WHEN IFNULL(e.rage, 0) > 0 THEN 1 ELSE 0 END) rage_views,
    SUM(CASE WHEN IFNULL(e.errors, 0) > 0 THEN 1 ELSE 0 END) error_views,
    SUM(IFNULL(e.errors, 0)) errors,
    SUM(CASE WHEN pv.duration_ms < 5000 AND IFNULL(e.clicks, 0) = 0 THEN 1 ELSE 0 END) bounces
  FROM pageviews pv
  LEFT JOIN (
    SELECT pageview_id,
      SUM(type='click') clicks, SUM(type='rage_click') rage,
      SUM(type='dead_click') dead, SUM(type='error') errors
    FROM events WHERE site_id=? AND ts>=? GROUP BY pageview_id
  ) e ON e.pageview_id = pv.id
  WHERE ${w.sql}
  ${group ? 'GROUP BY pv.path ORDER BY views DESC' : ''}`;
    const params = [f.siteId, f.from, ...w.params];
    const rows = db.prepare(sql).all(...params);
    return group ? rows.map(decorate) : decorate(rows[0] || {});
}

function overview(f) {
    const o = pageStats(f, false);
    const w = where(f, { ts: 'started_at', path: false });
    o.visitors = db.prepare(`SELECT COUNT(DISTINCT visitor_id) c FROM sessions WHERE ${w.sql}`).get(...w.params).c;
    o.new_visitors = db.prepare(`SELECT COUNT(*) c FROM sessions WHERE ${w.sql} AND is_new_visitor=1`).get(...w.params).c;
    o.returning_visitors = db.prepare(`SELECT COUNT(*) c FROM sessions WHERE ${w.sql} AND is_new_visitor=0`).get(...w.params).c;
    const pv = where(f, { ts: 'started_at', path: false });
    o.total_pages = db.prepare(`SELECT COUNT(DISTINCT path) c FROM pageviews WHERE ${pv.sql}`).get(...pv.params).c;
    return o;
}

const pages = (f) => pageStats(f, true);

/* ---------- Heatmap ---------- */
function heatmap(f, type) {
    const w0 = where(f, { pre: '', ts: 'started_at', path: true });
    const meta = db.prepare(
        `SELECT COUNT(*) views, AVG(doc_w) doc_w, MAX(doc_h) doc_h, AVG(max_scroll_pct) avg_scroll FROM pageviews WHERE ${w0.sql}`
    ).get(...w0.params);

    if (type === 'scroll') {
        const rows = db.prepare(`SELECT max_scroll_pct m FROM pageviews WHERE ${w0.sql} LIMIT 100000`).all(...w0.params);
        const total = rows.length;
        const reach = [];
        // Fixed: exact reach calculation - % of pageviews that reached each depth band
        for (let d = 0; d <= 95; d += 5) {
            const count = rows.filter((r) => r.m >= d).length;
            reach.push({ depth: d, pct: total ? Math.round((count / total) * 100) : 0 });
        }
        return { type, views: meta.views, avgScroll: Math.round(meta.avg_scroll || 0), reach, docW: meta.doc_w, docH: meta.doc_h };
    }

    const dbType = TYPE_MAP[type] || 'click';
    const w = where(f, { path: true });
    const points = db.prepare(`
    SELECT ROUND(x_pct * 200) / 200.0 AS x, (y / 8) * 8 AS y, COUNT(*) AS c
    FROM events WHERE ${w.sql} AND type = ? AND x_pct IS NOT NULL AND y IS NOT NULL
    GROUP BY 1, 2 ORDER BY c DESC LIMIT 20000`).all(...w.params, dbType);
    const total = points.reduce((a, p) => a + p.c, 0);
    return {
        type, points, max: points.length ? points[0].c : 0, total,
        views: meta.views, docW: Math.round(meta.doc_w || 0), docH: meta.doc_h,
    };
}

function elements(f) {
    const w = where(f, { path: true });
    return db.prepare(`
    SELECT selector, MAX(tag) tag, MAX(text) text,
      SUM(type='click') clicks, SUM(type='rage_click') rage, SUM(type='dead_click') dead,
      COUNT(DISTINCT session_id) users
    FROM events WHERE ${w.sql} AND type IN ('click','rage_click','dead_click') AND selector != ''
    GROUP BY selector ORDER BY clicks DESC LIMIT 30`).all(...w.params);
}

/* ---------- Other reports ---------- */
function timeseries(f) {
    const wp = where(f, { ts: 'started_at', path: true });
    const views = db.prepare(`
    SELECT strftime('%Y-%m-%d', started_at/1000, 'unixepoch') d, COUNT(*) views, COUNT(DISTINCT session_id) sessions
    FROM pageviews WHERE ${wp.sql} GROUP BY d ORDER BY d`).all(...wp.params);
    const we = where(f, { path: true });
    const clicks = db.prepare(`
    SELECT strftime('%Y-%m-%d', ts/1000, 'unixepoch') d, COUNT(*) clicks
    FROM events WHERE ${we.sql} AND type='click' GROUP BY d`).all(...we.params);
    const map = {};
    views.forEach((r) => { map[r.d] = { date: r.d, views: r.views, sessions: r.sessions, clicks: 0 }; });
    clicks.forEach((r) => { (map[r.d] = map[r.d] || { date: r.d, views: 0, sessions: 0, clicks: 0 }).clicks = r.clicks; });
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
}

function devices(f) {
    const w = where(f, { ts: 'started_at', path: false });
    const grp = (col) => db.prepare(
        `SELECT ${col} name, COUNT(*) count FROM sessions WHERE ${w.sql} GROUP BY ${col} ORDER BY count DESC`
    ).all(...w.params);
    return { device: grp('device_type'), browser: grp('browser'), os: grp('os') };
}

function sessions(f) {
    const w = where(f, { pre: 's.', ts: 'started_at', path: false });
    return db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id AND e.type='click') clicks,
      (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id AND e.type='rage_click') rage,
      (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id AND e.type='dead_click') dead,
      (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id AND e.type='error') errors
    FROM sessions s WHERE ${w.sql} ORDER BY s.started_at DESC LIMIT 100`).all(...w.params);
}

function sessionDetail(id, siteId) {
    const session = db.prepare('SELECT * FROM sessions WHERE id=? AND site_id=?').get(id, siteId);
    if (!session) return null;
    const pageviews = db.prepare('SELECT * FROM pageviews WHERE session_id=? ORDER BY started_at').all(id);
    const events = db.prepare(
        "SELECT type, ts, path, x_pct, y, selector, tag, text, extra FROM events WHERE session_id=? ORDER BY ts LIMIT 2000"
    ).all(id);
    return { session, pageviews, events };
}

function errors(f) {
    const w = where(f, { path: true });
    return db.prepare(`
    SELECT text message, path, COUNT(*) count, COUNT(DISTINCT session_id) sessions, MAX(ts) last_seen
    FROM events WHERE ${w.sql} AND type='error' GROUP BY text, path ORDER BY count DESC LIMIT 100`).all(...w.params);
}

function forms(f) {
    const w = where(f, { path: true });
    const fields = db.prepare(`
    SELECT path, text field, MAX(tag) tag, COUNT(*) interactions,
      ROUND(AVG(json_extract(extra, '$.ms'))) avg_ms,
      ROUND(100.0 * SUM(json_extract(extra, '$.changed')) / COUNT(*)) filled_pct
    FROM events WHERE ${w.sql} AND type='form_field' GROUP BY path, text ORDER BY interactions DESC LIMIT 100`).all(...w.params);
    const submits = db.prepare(`
    SELECT path, text form, COUNT(*) submits
    FROM events WHERE ${w.sql} AND type='form_submit' GROUP BY path, text ORDER BY submits DESC`).all(...w.params);
    return { fields, submits };
}

/* ---------- Funnels & User Flow ---------- */
function flow(f) {
    const w = where(f, { ts: 'started_at', path: false });

    // Top entry pages
    const entries = db.prepare(`
    SELECT entry_path path, COUNT(*) entries FROM sessions WHERE ${w.sql}
    AND entry_path != '' GROUP BY entry_path ORDER BY entries DESC LIMIT 10`).all(...w.params);

    // Exit pages: last pageview per session
    const exits = db.prepare(`
    SELECT pv.path, COUNT(*) exits FROM pageviews pv
    INNER JOIN (
      SELECT session_id, MAX(started_at) max_start FROM pageviews WHERE site_id=? AND started_at>=? GROUP BY session_id
    ) last ON pv.session_id = last.session_id AND pv.started_at = last.max_start
    WHERE pv.site_id=? AND pv.started_at>=?
    GROUP BY pv.path ORDER BY exits DESC LIMIT 10`).all(f.siteId, f.from, f.siteId, f.from);

    // Page-to-page transitions (ordered pageview pairs within same session)
    const transitions = db.prepare(`
    SELECT a.path AS from_path, b.path AS to_path, COUNT(*) count
    FROM pageviews a
    JOIN pageviews b ON a.session_id = b.session_id AND b.started_at > a.started_at
    WHERE a.site_id=? AND a.started_at>=?
    AND NOT EXISTS (
      SELECT 1 FROM pageviews c
      WHERE c.session_id = a.session_id AND c.started_at > a.started_at AND c.started_at < b.started_at
    )
    GROUP BY from_path, to_path ORDER BY count DESC LIMIT 30`).all(f.siteId, f.from);

    return { entries, exits, transitions };
}

/* ---------- Comparison (two periods) ---------- */
function compare(f) {
    const duration = f.range === 'all' ? 7 * DAY : (RANGES[f.range] || RANGES['7d']);
    const prevFrom = f.from - duration;
    const prevF = { ...f, from: prevFrom };

    const curr = pageStats(f, false);
    const prev = pageStats(prevF, false);

    const delta = (key) => {
        const c = curr[key] || 0;
        const p = prev[key] || 0;
        if (!p) return c > 0 ? 100 : 0;
        return Math.round(((c - p) / p) * 100);
    };

    const keys = ['views', 'sessions', 'clicks', 'rage_clicks', 'dead_clicks', 'errors',
        'avg_duration', 'avg_scroll', 'avg_load', 'bounce_rate', 'score'];
    const deltas = {};
    keys.forEach((k) => { deltas[k] = delta(k); });

    return { current: curr, previous: prev, deltas };
}

/* ---------- Top usability problems ---------- */
function topProblems(f) {
    const problems = [];

    // Pages sorted by worst score
    const pageList = pages(f).filter((p) => p.views > 0);
    pageList.sort((a, b) => (a.score || 0) - (b.score || 0));

    // Worst rage click elements
    const rageEls = db.prepare(`
    SELECT path, selector, MAX(text) text, SUM(type='rage_click') rage_clicks,
      COUNT(DISTINCT session_id) affected_sessions
    FROM events WHERE site_id=? AND ts>=? AND type='rage_click' AND selector != ''
    GROUP BY path, selector ORDER BY rage_clicks DESC LIMIT 5`).all(f.siteId, f.from);

    // Worst dead click elements
    const deadEls = db.prepare(`
    SELECT path, selector, MAX(text) text, SUM(type='dead_click') dead_clicks,
      COUNT(DISTINCT session_id) affected_sessions
    FROM events WHERE site_id=? AND ts>=? AND type='dead_click' AND selector != ''
    GROUP BY path, selector ORDER BY dead_clicks DESC LIMIT 5`).all(f.siteId, f.from);

    // Top errors
    const topErrors = db.prepare(`
    SELECT path, text message, COUNT(*) count, COUNT(DISTINCT session_id) affected_sessions
    FROM events WHERE site_id=? AND ts>=? AND type='error'
    GROUP BY path, text ORDER BY count DESC LIMIT 5`).all(f.siteId, f.from);

    // Assemble ranked problems
    rageEls.forEach((e) => problems.push({
        severity: 'high', type: 'rage_click',
        description: `${e.rage_clicks} rage clicks on "${e.text || e.selector}"`,
        page: e.path, element: e.selector, count: e.rage_clicks, sessions: e.affected_sessions,
    }));
    deadEls.forEach((e) => problems.push({
        severity: 'medium', type: 'dead_click',
        description: `${e.dead_clicks} dead clicks on "${e.text || e.selector}" (looks clickable but does nothing)`,
        page: e.path, element: e.selector, count: e.dead_clicks, sessions: e.affected_sessions,
    }));
    topErrors.forEach((e) => problems.push({
        severity: 'high', type: 'error',
        description: `JS error: ${e.message}`,
        page: e.path, element: null, count: e.count, sessions: e.affected_sessions,
    }));
    pageList.slice(0, 3).forEach((p) => {
        if (p.score !== null && p.score < 50) {
            problems.push({
                severity: p.score < 30 ? 'critical' : 'high', type: 'low_score',
                description: `Page "${p.path}" has a usability score of ${p.score}/100 (${p.grade})`,
                page: p.path, element: null, count: p.views, sessions: p.sessions,
            });
        }
    });

    // Sort: critical > high > medium, then by count
    const sev = { critical: 0, high: 1, medium: 2, low: 3 };
    problems.sort((a, b) => (sev[a.severity] - sev[b.severity]) || (b.count - a.count));

    return problems.slice(0, 10);
}

/* ---------- Data export ---------- */
function exportData(f, type) {
    switch (type) {
        case 'sessions': {
            const w = where(f, { pre: 's.', ts: 'started_at', path: false });
            return db.prepare(`SELECT s.* FROM sessions s WHERE ${w.sql} ORDER BY s.started_at DESC LIMIT 10000`).all(...w.params);
        }
        case 'pages': return pages(f);
        case 'errors': return errors(f);
        case 'forms': {
            const d = forms(f);
            return [...d.fields, ...d.submits];
        }
        case 'events': {
            const w = where(f, { path: !!f.path });
            return db.prepare(`SELECT * FROM events WHERE ${w.sql} ORDER BY ts DESC LIMIT 50000`).all(...w.params);
        }
        case 'elements': return elements(f);
        default: return [];
    }
}

/* ---------- Retention cleanup ---------- */
function purgeOldData(siteId, retentionDays) {
    const cutoff = Date.now() - retentionDays * DAY;
    const evDel = db.prepare('DELETE FROM events WHERE site_id=? AND ts<?').run(siteId, cutoff);
    const pvDel = db.prepare('DELETE FROM pageviews WHERE site_id=? AND started_at<?').run(siteId, cutoff);
    const sessDel = db.prepare('DELETE FROM sessions WHERE site_id=? AND last_seen_at<?').run(siteId, cutoff);
    return { events: evDel.changes, pageviews: pvDel.changes, sessions: sessDel.changes };
}

function deleteSiteData(siteId) {
    db.prepare('DELETE FROM events WHERE site_id=?').run(siteId);
    db.prepare('DELETE FROM pageviews WHERE site_id=?').run(siteId);
    db.prepare('DELETE FROM sessions WHERE site_id=?').run(siteId);
}

module.exports = {
    parseFilters, overview, pages, heatmap, elements,
    timeseries, devices, sessions, sessionDetail,
    errors, forms, flow, compare, topProblems,
    exportData, purgeOldData, deleteSiteData,
};