/* Usability Tracker Dashboard v2.0 */
(() => {
    'use strict';

    /* ── Helpers ─────────────────────────────────────────── */
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const ms = (v) => {
        if (!v) return '0s';
        const s = Math.round(v / 1000);
        return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
    };
    const pct = (v) => (Math.round((v || 0) * 1000) / 10).toFixed(1) + '%';
    const num = (v) => (v || 0).toLocaleString();
    const sc = (s) => (s == null ? 'na' : s >= 85 ? 'great' : s >= 70 ? 'good' : s >= 50 ? 'warn' : 'bad');
    const gaugeColor = { great: '#22c55e', good: '#84cc16', warn: '#f59e0b', bad: '#ef4444', na: '#475569' };
    const dt = (t) => t ? new Date(t).toLocaleString() : '—';
    const dateOnly = (t) => t ? new Date(t).toLocaleDateString() : '—';

    /* ── Toast notifications ─────────────────────────────── */
    function toast(msg, type = 'info', duration = 3500) {
        const box = document.getElementById('toasts');
        const t = document.createElement('div');
        t.className = 'toast' + (type === 'error' ? ' error' : type === 'success' ? ' success' : '');
        t.textContent = msg;
        box.appendChild(t);
        setTimeout(() => t.remove(), duration);
    }

    /* ── State ───────────────────────────────────────────── */
    let token = localStorage.getItem('ut_token') || '';
    let sites = [], site = null, activeTab = 'overview';
    let charts = {}, selectedPath = '', arTimer = null;

    /* ── API ─────────────────────────────────────────────── */
    async function call(path, params = {}, opt = {}) {
        const u = new URL('/api/admin' + path, location.origin);
        Object.entries(params).forEach(([k, v]) => {
            if (v !== undefined && v !== '' && v !== null) u.searchParams.set(k, v);
        });
        const r = await fetch(u, {
            method: opt.method || 'GET',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: opt.body ? JSON.stringify(opt.body) : undefined,
        });
        if (r.status === 401) { showLogin(); throw new Error('Unauthorized'); }
        if (r.status === 204) return null;
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.error || 'Request failed');
        }
        return r.json();
    }

    const F = () => ({
        site: site?.site_key,
        range: $('#range').value,
        device: $('#device').value,
    });

    /* ── Skeleton loader ─────────────────────────────────── */
    function skelGrid(n = 8) {
        return `<div class="grid">${Array(n).fill('<div class="card kpi skeleton" style="height:90px">&nbsp;</div>').join('')}</div>`;
    }

    /* ── Auth ────────────────────────────────────────────── */
    function showLogin() {
        $('#app').hidden = true;
        $('#login').hidden = false;
        $('#loginForm').hidden = false;
        $('#signupForm').hidden = true;
    }

    $('#showSignup').onclick = (e) => { e.preventDefault(); $('#loginForm').hidden = true; $('#signupForm').hidden = false; };
    $('#showLogin').onclick = (e) => { e.preventDefault(); $('#signupForm').hidden = true; $('#loginForm').hidden = false; };

    async function authCall(path, body, errEl) {
        try {
            const r = await fetch('/api/auth' + path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error || 'Authentication failed');
            return data.token;
        } catch (e) {
            errEl.textContent = '✗ ' + e.message;
            throw e;
        }
    }

    $('#loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('#loginBtn');
        btn.textContent = 'Logging in…';
        const errEl = $('#loginErr');
        errEl.textContent = '';
        try {
            token = await authCall('/login', { email: $('#loginEmail').value, password: $('#loginPassword').value }, errEl);
            localStorage.setItem('ut_token', token);
            boot();
        } catch {
            btn.textContent = 'Login →';
        }
    });

    $('#signupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('#signupBtn');
        btn.textContent = 'Signing up…';
        const errEl = $('#signupErr');
        errEl.textContent = '';
        try {
            token = await authCall('/signup', { email: $('#signupEmail').value, password: $('#signupPassword').value }, errEl);
            localStorage.setItem('ut_token', token);
            boot();
        } catch {
            btn.textContent = 'Sign Up →';
        }
    });

    $('#logout').onclick = () => {
        localStorage.removeItem('ut_token');
        token = '';
        if (arTimer) { clearInterval(arTimer); arTimer = null; }
        showLogin();
    };

    /* ── Boot ────────────────────────────────────────────── */
    async function boot() {
        try { await call('/ping'); } catch { return showLogin(); }
        $('#login').hidden = true;
        $('#app').hidden = false;
        sites = await call('/sites');
        $('#siteSel').innerHTML = sites.map((s) =>
            `<option value="${esc(s.site_key)}">${esc(s.name)}</option>`
        ).join('');
        site = sites[0];
        if (!site) {
            switchTab('install');
        } else {
            refresh();
        }
    }

    $('#siteSel').onchange = (e) => {
        site = sites.find((s) => s.site_key === e.target.value);
        selectedPath = '';
        refresh();
    };
    ['#range', '#device'].forEach((s) => $(s).addEventListener('change', refresh));
    $('#refresh').onclick = refresh;

    /* ── Auto-refresh ────────────────────────────────────── */
    $('#autoRefresh').onchange = function () {
        const dot = $('#arDot');
        if (this.checked) {
            arTimer = setInterval(refresh, 60000);
            dot.hidden = false;
        } else {
            clearInterval(arTimer); arTimer = null;
            dot.hidden = true;
        }
    };

    /* ── Tabs ────────────────────────────────────────────── */
    $$('#tabs button').forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));

    function switchTab(t) {
        activeTab = t;
        $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
        $$('main section').forEach((s) => (s.hidden = s.id !== 'tab-' + t));
        refresh();
    }

    const loaders = { overview, problems, pages, heatmaps, flow, sessions, issues, compare, install };

    async function refresh() {
        if (!site && activeTab !== 'install') {
            $('#tab-' + activeTab).innerHTML = '<div class="empty"><span class="icon">⚠️</span>Please add a site first. Go to Install / Sites.</div>';
            return;
        }
        const box = $('#tab-' + activeTab);
        box.innerHTML = skelGrid();
        try {
            await loaders[activeTab](box);
        } catch (e) {
            box.innerHTML = `<div class="empty"><span class="icon">⚠️</span>Error loading data: ${esc(e.message)}</div>`;
            toast(e.message, 'error');
        }
    }

    /* ── KPI tooltip HTML ─────────────────────────────────── */
    const TOOLTIPS = {
        views: 'Total number of page views (one per page load or SPA route change)',
        sessions: 'Unique browsing sessions (30-min inactivity resets session)',
        visitors: 'Unique visitors identified by a localStorage cookie',
        avg_duration: 'Average time spent on a page from load to unload',
        avg_active: 'Average time the user was actually active (moving/clicking/typing)',
        avg_scroll: 'Average maximum scroll depth reached (100% = bottom of page)',
        bounce_rate: 'Visits with < 5s time and no clicks (likely didn\'t engage)',
        clicks: 'Total click events recorded',
        rage_clicks: '3+ clicks in 1s within 40px — indicates frustration',
        dead_clicks: 'Clicks on elements that looked clickable but did nothing',
        errors: 'JavaScript errors and unhandled promise rejections',
        avg_load: 'Average page load time (time to DOMContentLoaded)',
        score: 'Usability Score (0–100): 100 minus penalties for rage, dead, errors, bounce, low scroll, slow load',
    };

    const kpi = (id, label, value, cls = '') => `
    <div class="card kpi ${cls}">
        <div class="lbl">${label}
            ${TOOLTIPS[id] ? `<span class="tooltip-wrap">
                <span class="tip-icon">ⓘ</span>
                <span class="tip-text">${esc(TOOLTIPS[id])}</span>
            </span>` : ''}
        </div>
        <div class="val">${value}</div>
    </div>`;

    const insightsHtml = (list) => list.map((i) =>
        `<div class="insight ${i.level}">
            <span>${i.level === 'good' ? '✅' : i.level === 'bad' ? '🔴' : '🟡'}</span>
            <span>${esc(i.text)}</span>
        </div>`
    ).join('');

    /* ── OVERVIEW ─────────────────────────────────────────── */
    async function overview(box) {
        const [o, ts, dv] = await Promise.all([
            call('/overview', F()),
            call('/timeseries', F()),
            call('/devices', F()),
        ]);
        const cls = sc(o.score);
        const gcol = gaugeColor[cls];

        box.innerHTML = `
        <div class="card" style="margin-bottom:16px">
            <div class="score-wrap">
                <div class="gauge" style="background:conic-gradient(${gcol} ${(o.score||0)*3.6}deg,#334155 0)">
                    <div class="gauge-inner">${o.score ?? '–'}</div>
                </div>
                <div class="score-info">
                    <div class="score-grade" style="color:${gcol}">Usability Score: ${esc(o.grade)}</div>
                    <div class="score-desc">Scored 0–100 by penalising rage clicks, dead clicks, JS errors, high bounce rate, low scroll depth, and slow load time. Higher is better.</div>
                </div>
            </div>
        </div>

        <div class="grid">
            ${kpi('views','Page Views', num(o.views))}
            ${kpi('sessions','Sessions', num(o.sessions))}
            ${kpi('visitors','Visitors', num(o.visitors))}
            ${kpi('avg_duration','Avg. Time', ms(o.avg_duration))}
            ${kpi('avg_active','Active Time', ms(o.avg_active))}
            ${kpi('avg_scroll','Avg. Scroll', (o.avg_scroll||0)+'%')}
            ${kpi('bounce_rate','Bounce Rate', pct(o.bounce_rate))}
            ${kpi('avg_load','Load Time', ms(o.avg_load))}
            ${kpi('clicks','Clicks', num(o.clicks))}
            ${kpi('rage_clicks','Rage Clicks', num(o.rage_clicks))}
            ${kpi('dead_clicks','Dead Clicks', num(o.dead_clicks))}
            ${kpi('errors','JS Errors', num(o.errors))}
        </div>

        <div class="row">
            <div class="card">
                <h3>Traffic &amp; Clicks Over Time</h3>
                <canvas id="chTs" height="120"></canvas>
            </div>
            <div class="card">
                <h3>Device Breakdown</h3>
                <canvas id="chDev" height="220"></canvas>
            </div>
        </div>

        <div class="row-equal">
            <div class="card">
                <h3>Usability Insights</h3>
                ${insightsHtml(o.insights)}
            </div>
            <div class="card">
                <h3>Visitor Breakdown</h3>
                <div style="margin-bottom:12px">
                    <div class="mini" style="margin-bottom:6px">New vs Returning</div>
                    ${visitorBar(o.new_visitors||0, o.returning_visitors||0)}
                </div>
                <h3 style="margin-top:14px">Browsers</h3>
                ${dv.browser.map((b) => `<div class="mini" style="margin:3px 0">${esc(b.name)}: <b>${b.count}</b></div>`).join('') || '—'}
                <h3 style="margin-top:12px">Operating Systems</h3>
                ${dv.os.map((b) => `<div class="mini" style="margin:3px 0">${esc(b.name)}: <b>${b.count}</b></div>`).join('') || '—'}
            </div>
        </div>`;

        // Charts
        destroyCharts(['ts', 'dev']);
        charts.ts = new Chart($('#chTs'), {
            type: 'line',
            data: {
                labels: ts.map((r) => r.date),
                datasets: [
                    { label: 'Page views', data: ts.map((r) => r.views), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.08)', tension: 0.4, fill: true },
                    { label: 'Sessions', data: ts.map((r) => r.sessions), borderColor: '#22c55e', tension: 0.4 },
                    { label: 'Clicks', data: ts.map((r) => r.clicks), borderColor: '#ef4444', tension: 0.4 },
                ],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { labels: { color: '#94a3b8' } } },
                scales: {
                    x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } },
                    y: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
                },
            },
        });
        charts.dev = new Chart($('#chDev'), {
            type: 'doughnut',
            data: {
                labels: dv.device.map((d) => d.name),
                datasets: [{
                    data: dv.device.map((d) => d.count),
                    backgroundColor: ['#3b82f6', '#f59e0b', '#22c55e', '#475569'],
                    borderWidth: 2, borderColor: '#1e293b',
                }],
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position: 'bottom', labels: { color: '#94a3b8', padding: 10 } },
                },
            },
        });
    }

    function visitorBar(nw, ret) {
        const total = nw + ret || 1;
        const nwP = Math.round(nw / total * 100);
        return `
        <div style="display:flex;gap:6px;align-items:center;font-size:12px">
            <div style="flex:1;height:10px;border-radius:5px;background:#334155;overflow:hidden">
                <div style="width:${nwP}%;height:100%;background:#3b82f6;border-radius:5px"></div>
            </div>
            <span style="color:#7dd3fc">New ${nw}</span>
            <span style="color:#94a3b8">/ Ret. ${ret}</span>
        </div>`;
    }

    /* ── TOP PROBLEMS ────────────────────────────────────── */
    async function problems(box) {
        const probs = await call('/top-problems', F());
        if (!probs.length) {
            box.innerHTML = `<div class="empty"><span class="icon">✅</span>No significant usability problems detected.</div>`;
            return;
        }
        box.innerHTML = `
        <h2>🚨 Top Usability Problems</h2>
        <p class="mini" style="margin-bottom:16px">Automatically ranked by severity and impact. Fix these first for the biggest improvement in usability.</p>
        <div class="tw"><table>
            <tr><th>#</th><th>Severity</th><th>Type</th><th>Description</th><th>Page</th><th>Element</th><th>Count</th><th>Sessions</th></tr>
            ${probs.map((p, i) => `<tr>
                <td><b>${i + 1}</b></td>
                <td><span class="sev ${p.severity}">${p.severity}</span></td>
                <td><code>${esc(p.type)}</code></td>
                <td>${esc(p.description)}</td>
                <td><code>${esc(p.page || '—')}</code></td>
                <td>${p.element ? `<code>${esc(p.element)}</code>` : '—'}</td>
                <td><b>${num(p.count)}</b></td>
                <td>${num(p.sessions)}</td>
            </tr>`).join('')}
        </table></div>`;
    }

    /* ── PAGES ────────────────────────────────────────────── */
    async function pages(box) {
        const rows = await call('/pages', F());
        if (!rows.length) {
            box.innerHTML = `<div class="empty"><span class="icon">📭</span>No page data yet. Open the demo site and click around.</div>`;
            return;
        }
        const exportBtns = `
        <div class="toolbar">
            <h2 style="margin:0">Page-level Usability</h2>
            <button class="btn ghost small" id="expPagesCsv">⬇ Export CSV</button>
        </div>`;
        box.innerHTML = exportBtns + `<div class="tw"><table>
        <tr>
            <th>Page</th><th>Score</th><th>Views</th>
            <th title="${TOOLTIPS.avg_duration}">Avg Time</th>
            <th title="${TOOLTIPS.avg_scroll}">Scroll</th>
            <th>Clicks</th><th title="${TOOLTIPS.rage_clicks}">Rage</th>
            <th title="${TOOLTIPS.dead_clicks}">Dead</th>
            <th title="${TOOLTIPS.errors}">Errors</th>
            <th title="${TOOLTIPS.bounce_rate}">Bounce</th>
            <th>Load</th><th>Issues</th><th></th>
        </tr>
        ${rows.map((r) => `<tr>
            <td><b><code>${esc(r.path)}</code></b></td>
            <td><span class="pill ${sc(r.score)}">${r.score ?? '–'}</span></td>
            <td>${num(r.views)}</td>
            <td>${ms(r.avg_duration)}</td>
            <td>${r.avg_scroll}%</td>
            <td>${num(r.clicks)}</td>
            <td>${r.rage_clicks > 0 ? `<span style="color:#fca5a5;font-weight:700">${r.rage_clicks}</span>` : 0}</td>
            <td>${r.dead_clicks > 0 ? `<span style="color:#fde68a;font-weight:700">${r.dead_clicks}</span>` : 0}</td>
            <td>${r.errors > 0 ? `<span style="color:#fca5a5;font-weight:700">${r.errors}</span>` : 0}</td>
            <td>${pct(r.bounce_rate)}</td>
            <td>${ms(r.avg_load)}</td>
            <td>${r.insights.map((i) =>
                `<div class="mini">${i.level === 'good' ? '✅' : i.level === 'bad' ? '🔴' : '🟡'} ${esc(i.text)}</div>`
            ).join('')}</td>
            <td><button class="btn small" data-hm="${esc(r.path)}">🔥 Heatmap</button></td>
        </tr>`).join('')}
        </table></div>`;

        $$('[data-hm]', box).forEach((b) => (b.onclick = () => {
            selectedPath = b.dataset.hm; switchTab('heatmaps');
        }));
        $('#expPagesCsv').onclick = () => exportCsv('pages', F());
    }

    /* ── HEATMAPS ─────────────────────────────────────────── */
    async function heatmaps(box) {
        const rows = await call('/pages', F());
        if (!rows.length) {
            box.innerHTML = `<div class="empty"><span class="icon">📭</span>No data yet. Interact with the demo site first.</div>`;
            return;
        }
        if (!selectedPath || !rows.find((r) => r.path === selectedPath)) {
            selectedPath = rows[0].path;
        }
        const origin = (site.origin || location.origin).replace(/\/$/, '');
        const url = () => `${origin}${selectedPath}?ut_admin=${encodeURIComponent(token)}&ut_open=1`;

        box.innerHTML = `
        <h2>🔥 Live Heatmap Viewer</h2>
        <div class="toolbar">
            <select id="hmPage" style="max-width:300px">
                ${rows.map((r) => `<option ${r.path === selectedPath ? 'selected' : ''}>${esc(r.path)}</option>`).join('')}
            </select>
            <button class="btn ghost small" data-w="1280">🖥 Desktop</button>
            <button class="btn ghost small" data-w="820">📱 Tablet</button>
            <button class="btn ghost small" data-w="390">📲 Mobile</button>
            <a class="btn small" id="hmOpen" target="_blank" rel="noopener" style="text-decoration:none">Open ↗</a>
            <span class="mini">Controls in the floating panel (bottom-right corner of the page).</span>
        </div>
        <div class="frame"><iframe id="hmFrame" style="width:1280px"></iframe></div>
        <div style="margin-top:16px">
            <div class="toolbar">
                <h3 style="margin:0">Top Clicked Elements</h3>
                <button class="btn ghost small" id="expElCsv">⬇ Export CSV</button>
            </div>
            <div id="elTable"></div>
        </div>`;

        const setFrame = () => {
            $('#hmFrame').src = url();
            $('#hmOpen').href = url();
        };
        $('#hmPage').onchange = (e) => { selectedPath = e.target.value; setFrame(); loadEls(box); };
        $$('[data-w]', box).forEach((b) => (b.onclick = () => {
            $('#hmFrame').style.width = b.dataset.w + 'px';
            $('#hmFrame').src = url();
        }));
        $('#expElCsv').onclick = () => exportCsv('elements', { ...F(), path: selectedPath });
        setFrame();
        loadEls(box);
    }

    async function loadEls(box) {
        const els = await call('/elements', { ...F(), path: selectedPath });
        const total = els.reduce((a, e) => a + e.clicks, 0) || 1;
        const elBox = $('#elTable', box);
        if (!elBox) return;
        elBox.innerHTML = els.length
            ? `<div class="tw"><table>
            <tr><th>Element</th><th>Tag</th><th>Text</th><th>Clicks</th><th>Share</th><th>Users</th><th>Rage</th><th>Dead</th></tr>
            ${els.map((e) => `<tr>
                <td><code>${esc(e.selector)}</code></td>
                <td>${esc(e.tag)}</td>
                <td>${esc(e.text || '—')}</td>
                <td><b>${e.clicks}</b></td>
                <td><div style="display:flex;align-items:center;gap:6px">
                    <div style="width:60px;height:6px;background:#334155;border-radius:3px;overflow:hidden">
                        <div style="width:${Math.round(e.clicks/total*100)}%;height:100%;background:#3b82f6"></div>
                    </div>
                    ${Math.round(e.clicks / total * 100)}%
                </div></td>
                <td>${e.users}</td>
                <td>${e.rage > 0 ? `<span style="color:#fca5a5">${e.rage}</span>` : 0}</td>
                <td>${e.dead > 0 ? `<span style="color:#fde68a">${e.dead}</span>` : 0}</td>
            </tr>`).join('')}
            </table></div>`
            : '<div class="empty" style="padding:30px">No click data for this page / filter.</div>';
    }

    /* ── FLOW ─────────────────────────────────────────────── */
    async function flow(box) {
        const d = await call('/flow', F());
        const maxEntry = d.entries[0]?.entries || 1;
        const maxExit = d.exits[0]?.exits || 1;
        const maxTrans = d.transitions[0]?.count || 1;

        box.innerHTML = `
        <h2>🔀 User Flow</h2>
        <div class="row">
            <div class="card">
                <h3>Top Entry Pages</h3>
                ${d.entries.length ? d.entries.map((e) => `
                <div class="flow-row">
                    <code style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.path)}</code>
                    <div class="flow-bar" style="width:${Math.round(e.entries/maxEntry*120)}px"></div>
                    <b style="min-width:40px;text-align:right">${num(e.entries)}</b>
                </div>`).join('') : '<div class="empty" style="padding:20px">No data</div>'}
            </div>
            <div class="card">
                <h3>Top Exit Pages</h3>
                ${d.exits.length ? d.exits.map((e) => `
                <div class="flow-row">
                    <code style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.path)}</code>
                    <div class="flow-bar" style="width:${Math.round(e.exits/maxExit*120)}px;background:linear-gradient(90deg,#ef4444,#dc2626)"></div>
                    <b style="min-width:40px;text-align:right">${num(e.exits)}</b>
                </div>`).join('') : '<div class="empty" style="padding:20px">No data</div>'}
            </div>
        </div>
        <div class="card">
            <h3>Page-to-Page Transitions</h3>
            ${d.transitions.length ? `<div class="tw"><table>
                <tr><th>From</th><th>To</th><th>Count</th><th>Flow</th></tr>
                ${d.transitions.map((t) => `<tr>
                    <td><code>${esc(t.from_path)}</code></td>
                    <td><code>${esc(t.to_path)}</code></td>
                    <td><b>${num(t.count)}</b></td>
                    <td><div style="display:flex;align-items:center;gap:6px">
                        <div style="width:${Math.round(t.count/maxTrans*100)}px;height:8px;background:linear-gradient(90deg,#3b82f6,#22c55e);border-radius:4px;min-width:2px"></div>
                    </div></td>
                </tr>`).join('')}
            </table></div>` : '<div class="empty" style="padding:30px">No multi-page sessions yet.</div>'}
        </div>`;
    }

    /* ── SESSIONS ─────────────────────────────────────────── */
    async function sessions(box) {
        const rows = await call('/sessions', F());
        box.innerHTML = `
        <div class="toolbar">
            <h2 style="margin:0">Recent Sessions</h2>
            <button class="btn ghost small" id="expSessCsv">⬇ Export CSV</button>
        </div>` +
        (rows.length
            ? `<div class="tw"><table>
            <tr><th>Started</th><th>Device</th><th>Browser/OS</th><th>Entry</th>
                <th>Pages</th><th>Duration</th><th>Clicks</th><th>Rage</th><th>Dead</th><th>Errors</th>
                <th>New?</th><th>Referrer</th><th></th></tr>
            ${rows.map((s) => `<tr>
                <td><span style="font-size:12px">${dt(s.started_at)}</span></td>
                <td>${esc(s.device_type)}<br><span class="mini">${s.viewport_w}×${s.viewport_h}</span></td>
                <td>${esc(s.browser)} / ${esc(s.os)}</td>
                <td><code style="font-size:11px">${esc(s.entry_path)}</code></td>
                <td>${s.page_count}</td>
                <td>${ms(s.last_seen_at - s.started_at)}</td>
                <td>${s.clicks}</td>
                <td>${s.rage > 0 ? `<span style="color:#fca5a5;font-weight:700">${s.rage}</span>` : 0}</td>
                <td>${s.dead > 0 ? `<span style="color:#fde68a;font-weight:700">${s.dead}</span>` : 0}</td>
                <td>${s.errors > 0 ? `<span style="color:#fca5a5;font-weight:700">${s.errors}</span>` : 0}</td>
                <td>${s.is_new_visitor ? '🆕 New' : 'Return'}</td>
                <td><span class="mini">${esc(s.referrer ? new URL('http://x' + s.referrer).hostname || s.referrer : 'direct')}</span></td>
                <td><button class="btn small" data-s="${esc(s.id)}">▶ Replay</button></td>
            </tr>`).join('')}
            </table></div>`
            : '<div class="empty"><span class="icon">📭</span>No sessions yet.</div>');

        $$('[data-s]', box).forEach((b) => (b.onclick = () => sessionDetail(b.dataset.s)));
        const expBtn = $('#expSessCsv', box);
        if (expBtn) expBtn.onclick = () => exportCsv('sessions', F());
    }

    async function sessionDetail(id) {
        const d = await call('/sessions/' + id, { site: site.site_key });
        if (!d) { toast('Session not found', 'error'); return; }

        const icon = {
            click: '🖱', rage_click: '😡', dead_click: '💀', error: '🐞',
            form_field: '📝', form_submit: '✅', custom: '⭐', move: '↗',
        };

        // Filter move events for replay
        const moveEvents = d.events.filter((e) => e.type === 'move' && e.x_pct != null && e.y != null);
        const clickEvents = d.events.filter((e) => (e.type === 'click' || e.type === 'rage_click') && e.x_pct != null && e.y != null);

        const maxDocW = Math.max(...d.pageviews.map((p) => p.doc_w || 800), 800);
        const maxDocH = Math.max(...d.pageviews.map((p) => p.doc_h || 600), 600);

        $('#dlgBody').innerHTML = `
        <h3 style="margin-bottom:4px">
            Session <code style="font-size:14px">${esc(id.slice(0, 8))}…</code>
            ${d.session.is_new_visitor ? '🆕' : '🔄'}
            ${esc(d.session.device_type)} · ${esc(d.session.browser)} / ${esc(d.session.os)}
        </h3>
        <p class="mini" style="margin-bottom:16px">
            Started ${dt(d.session.started_at)} · Duration ${ms(d.session.last_seen_at - d.session.started_at)} ·
            Referrer: ${esc(d.session.referrer || 'direct')}
        </p>

        ${moveEvents.length || clickEvents.length ? `
        <h3>Session Replay (Mouse Path)</h3>
        <canvas id="replayCanvas" width="${Math.min(maxDocW, 800)}" height="${Math.min(maxDocH * 0.4, 400)}"></canvas>
        <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn small success" id="replayPlay">▶ Play</button>
            <button class="btn ghost small" id="replayReset">↺ Reset</button>
            <span class="mini" style="align-self:center">Mouse path shown as gradient line; clicks as dots.</span>
        </div>` : ''}

        <h3 style="margin-top:16px">Pages Visited</h3>
        <div class="tl">
            ${d.pageviews.map((p) => `
            <div class="tl-item">
                <b>${esc(p.path)}</b>
                <span class="mini">
                    Time: ${ms(p.duration_ms)} · Active: ${ms(p.active_ms)} ·
                    Scroll: ${p.max_scroll_pct}% · Load: ${ms(p.load_time_ms)}
                </span>
            </div>`).join('')}
        </div>

        <h3>Event Timeline</h3>
        <div class="tl">
            ${d.events.filter((e) => e.type !== 'move').map((e) => `
            <div class="tl-item">
                ${icon[e.type] || '•'} <b>${esc(e.type)}</b>
                on <code style="font-size:11px">${esc(e.path)}</code>
                ${e.selector ? `→ <code style="font-size:11px">${esc(e.selector)}</code>` : ''}
                ${e.text ? `"${esc(e.text)}"` : ''}
                <span class="mini">${new Date(e.ts).toLocaleTimeString()}</span>
            </div>`).join('') || '<div class="mini">No events</div>'}
        </div>`;

        $('#dlg').showModal();

        // Session replay
        const canvas = $('#replayCanvas');
        if (canvas && (moveEvents.length || clickEvents.length)) {
            const ctx = canvas.getContext('2d');
            const W = canvas.width, H = canvas.height;
            let frame = 0, animId = null;

            const allPts = moveEvents.map((e) => ({
                x: e.x_pct * W, y: Math.min(e.y / maxDocH, 1) * H, type: 'move', ts: e.ts,
            })).concat(clickEvents.map((e) => ({
                x: e.x_pct * W, y: Math.min(e.y / maxDocH, 1) * H, type: e.type, ts: e.ts,
            }))).sort((a, b) => a.ts - b.ts);

            function draw() {
                ctx.clearRect(0, 0, W, H);
                ctx.fillStyle = '#0f172a';
                ctx.fillRect(0, 0, W, H);

                if (frame < 2) { frame++; }
                const pts = allPts.slice(0, frame);

                // Draw path
                if (pts.length > 1) {
                    for (let i = 1; i < pts.length; i++) {
                        if (pts[i].type !== 'move') continue;
                        const alpha = i / pts.length;
                        ctx.beginPath();
                        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
                        ctx.lineTo(pts[i].x, pts[i].y);
                        ctx.strokeStyle = `hsla(${200 + alpha * 120},80%,60%,${alpha * 0.8 + 0.1})`;
                        ctx.lineWidth = 2;
                        ctx.stroke();
                    }
                }
                // Draw clicks
                pts.filter((p) => p.type !== 'move').forEach((p) => {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.type === 'rage_click' ? 10 : 6, 0, Math.PI * 2);
                    ctx.fillStyle = p.type === 'rage_click' ? '#ef4444' : '#f97316';
                    ctx.globalAlpha = 0.85;
                    ctx.fill();
                    ctx.globalAlpha = 1;
                });
                // Cursor position
                const last = pts[pts.length - 1];
                if (last && last.type === 'move') {
                    ctx.beginPath();
                    ctx.arc(last.x, last.y, 5, 0, Math.PI * 2);
                    ctx.fillStyle = '#fff';
                    ctx.fill();
                }

                if (frame < allPts.length) {
                    frame += Math.max(1, Math.floor(allPts.length / 200));
                    animId = requestAnimationFrame(draw);
                }
            }

            $('#replayPlay').onclick = () => { cancelAnimationFrame(animId); draw(); };
            $('#replayReset').onclick = () => {
                cancelAnimationFrame(animId); animId = null; frame = 0;
                ctx.clearRect(0, 0, W, H);
                ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, W, H);
            };
            // Auto-draw static snapshot
            frame = allPts.length;
            draw();
        }
    }

    /* ── ISSUES (Errors & Forms) ────────────────────────── */
    async function issues(box) {
        const [er, fm] = await Promise.all([call('/errors', F()), call('/forms', F())]);
        box.innerHTML = `
        <div class="toolbar">
            <h2 style="margin:0">JavaScript Errors</h2>
            <button class="btn ghost small" id="expErrCsv">⬇ Export CSV</button>
        </div>
        ${er.length
            ? `<div class="tw"><table>
                <tr><th>Message</th><th>Page</th><th>Count</th><th>Sessions</th><th>Last Seen</th></tr>
                ${er.map((e) => `<tr>
                    <td style="max-width:400px;word-break:break-word">${esc(e.message)}</td>
                    <td><code>${esc(e.path)}</code></td>
                    <td><b>${e.count}</b></td>
                    <td>${e.sessions}</td>
                    <td><span class="mini">${dt(e.last_seen)}</span></td>
                </tr>`).join('')}
            </table></div>`
            : '<div class="empty" style="padding:30px">🎉 No JS errors detected!</div>'}

        <div class="toolbar" style="margin-top:24px">
            <h2 style="margin:0">Form Field Analytics</h2>
            <button class="btn ghost small" id="expFormCsv">⬇ Export CSV</button>
        </div>
        ${fm.fields.length
            ? `<div class="tw"><table>
                <tr><th>Page</th><th>Field</th><th>Type</th><th>Interactions</th><th>Avg Time in Field</th><th>Filled %</th></tr>
                ${fm.fields.map((f) => `<tr>
                    <td><code>${esc(f.path)}</code></td>
                    <td><b>${esc(f.field)}</b></td>
                    <td>${esc(f.tag)}</td>
                    <td>${f.interactions}</td>
                    <td>${ms(f.avg_ms)}</td>
                    <td>
                        <div style="display:flex;align-items:center;gap:6px">
                            <div style="width:60px;height:6px;background:#334155;border-radius:3px;overflow:hidden">
                                <div style="width:${f.filled_pct}%;height:100%;background:#22c55e"></div>
                            </div>
                            ${f.filled_pct}%
                        </div>
                    </td>
                </tr>`).join('')}
            </table></div>`
            : '<div class="empty" style="padding:30px">No form interaction data yet.</div>'}

        <h3 style="margin-top:20px">Form Submissions</h3>
        ${fm.submits.length
            ? `<div class="tw"><table>
                <tr><th>Page</th><th>Form</th><th>Submissions</th></tr>
                ${fm.submits.map((s) => `<tr>
                    <td><code>${esc(s.path)}</code></td>
                    <td>${esc(s.form)}</td>
                    <td><b>${s.submits}</b></td>
                </tr>`).join('')}
            </table></div>`
            : '<div class="mini" style="padding:12px">No form submissions recorded.</div>'}`;

        $('#expErrCsv')?.addEventListener('click', () => exportCsv('errors', F()));
        $('#expFormCsv')?.addEventListener('click', () => exportCsv('forms', F()));
    }

    /* ── COMPARE ─────────────────────────────────────────── */
    async function compare(box) {
        const data = await call('/compare', F());
        const curr = data.current, prev = data.previous, deltas = data.deltas;

        const dRow = (label, key, fmt = num, higherBetter = true) => {
            const d = deltas[key];
            const dir = d > 0 ? (higherBetter ? 'pos' : 'neg') : d < 0 ? (higherBetter ? 'neg' : 'pos') : 'neu';
            const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '—';
            return `<tr>
                <td>${label}</td>
                <td><b>${fmt(curr[key])}</b></td>
                <td>${fmt(prev[key])}</td>
                <td class="delta-${dir}">${arrow} ${Math.abs(d)}%</td>
            </tr>`;
        };

        box.innerHTML = `
        <h2>📈 Period Comparison</h2>
        <p class="mini" style="margin-bottom:16px">
            Current period vs the same-length period immediately before it.
            ▲ = increased, ▼ = decreased.
        </p>
        <div class="tw"><table>
            <tr><th>Metric</th><th>Current Period</th><th>Previous Period</th><th>Change</th></tr>
            ${dRow('Page Views', 'views')}
            ${dRow('Sessions', 'sessions')}
            ${dRow('Clicks', 'clicks')}
            ${dRow('Rage Clicks', 'rage_clicks', num, false)}
            ${dRow('Dead Clicks', 'dead_clicks', num, false)}
            ${dRow('JS Errors', 'errors', num, false)}
            ${dRow('Avg. Time on Page', 'avg_duration', ms)}
            ${dRow('Avg. Scroll Depth', 'avg_scroll', (v) => (v||0)+'%')}
            ${dRow('Avg. Load Time', 'avg_load', ms, false)}
            ${dRow('Bounce Rate', 'bounce_rate', pct, false)}
            ${dRow('Usability Score', 'score', num)}
        </table></div>

        <div class="row-equal" style="margin-top:16px">
            <div class="card">
                <h3>Current Period Insights</h3>
                ${insightsHtml(curr.insights)}
            </div>
            <div class="card">
                <h3>Previous Period Insights</h3>
                ${insightsHtml(prev.insights)}
            </div>
        </div>`;
    }

    /* ── INSTALL / SITES ──────────────────────────────────── */
    async function install(box) {
        sites = await call('/sites');
        const snippet = (key) => `<script src="${location.origin}/tracker.js" data-site="${key}" data-api="${location.origin}" defer><\/script>`;

        box.innerHTML = `
        <h2>⚙️ Install on your Website</h2>
        ${site ? `
        <p style="margin-bottom:12px;color:var(--text2)">
            Add this single line to your website's <code>&lt;head&gt;</code> or before <code>&lt;/body&gt;</code>:
        </p>
        <pre id="snippet">${esc(snippet(site.site_key))}</pre>
        <button class="btn ghost small" id="copySnippet" style="margin-top:8px">📋 Copy</button>
        ` : `<div class="card kpi warn" style="margin-top:12px"><b>No sites added yet. Add a site below to get your tracking code.</b></div>`}

        <h3 style="margin-top:24px">Optional Attributes</h3>
        <div class="tw"><table>
            <tr><th>Attribute</th><th>Default</th><th>Description</th></tr>
            <tr><td><code>data-moves="off"</code></td><td>on</td><td>Disable mouse movement tracking</td></tr>
            <tr><td><code>data-respect-dnt="true"</code></td><td>false</td><td>Honour browser Do-Not-Track setting</td></tr>
            <tr><td><code>data-mask-text="true"</code></td><td>false</td><td>Replace all captured text with *** (extra privacy)</td></tr>
            <tr><td><code>data-ut-ignore</code></td><td>—</td><td>Add to any element to exclude it from tracking</td></tr>
        </table></div>

        <h3 style="margin-top:24px">View Heatmap on Live Page</h3>
        <p class="mini" style="margin-bottom:8px">
            Add <code>?ut_admin=YOUR_TOKEN&amp;ut_open=1</code> to any tracked page URL to enable the heatmap overlay.
        </p>

        <h3 style="margin-top:24px">Registered Sites</h3>
        <div class="tw"><table>
            <tr><th>Name</th><th>Origin</th><th>Site Key</th><th>Created</th><th>Actions</th></tr>
            ${sites.map((s) => `<tr>
                <td><b>${esc(s.name)}</b></td>
                <td>${esc(s.origin || '—')}</td>
                <td><code>${esc(s.site_key)}</code></td>
                <td><span class="mini">${dateOnly(s.created_at)}</span></td>
                <td style="display:flex;gap:6px;flex-wrap:wrap">
                    <button class="btn xs ghost" data-rot="${s.id}" title="Generate a new site key">🔑 Rotate Key</button>
                    <button class="btn xs ghost" data-del="${s.id}" title="Delete all analytics data for this site" style="color:#fca5a5">🗑 Clear Data</button>
                </td>
            </tr>`).join('')}
        </table></div>
        <p style="margin-top:14px">
            <button class="btn" id="addSite">+ Add New Site</button>
        </p>`;

        if (site) {
            $('#copySnippet').onclick = () => {
                navigator.clipboard.writeText(snippet(site.site_key))
                    .then(() => toast('Snippet copied!', 'success'))
                    .catch(() => toast('Could not copy', 'error'));
            };
        }

        $$('[data-rot]', box).forEach((b) => (b.onclick = async () => {
            if (!confirm('Rotate site key? You must update your embed script.')) return;
            const res = await call('/sites/' + b.dataset.rot + '/rotate-key', {}, { method: 'POST' });
            toast(res.message, 'success');
            install(box);
        }));

        $$('[data-del]', box).forEach((b) => (b.onclick = async () => {
            if (!confirm('Delete ALL analytics data for this site? This cannot be undone.')) return;
            await call('/sites/' + b.dataset.del + '/data', {}, { method: 'DELETE' });
            toast('All data deleted', 'success');
        }));

        $('#addSite').onclick = async () => {
            const name = prompt('Site name?');
            if (!name) return;
            const origin = prompt('Site origin (e.g. https://mysite.com)? Leave blank for any.') || '';
            await call('/sites', {}, { method: 'POST', body: { name, origin } });
            sites = await call('/sites');
            site = sites.find(s => s.name === name) || sites[0]; // Auto-select new site
            $('#siteSel').innerHTML = sites.map((s) =>
                `<option value="${esc(s.site_key)}" ${s.site_key === site?.site_key ? 'selected' : ''}>${esc(s.name)}</option>`
            ).join('');
            toast('Site added!', 'success');
            install(box);
        };
    }

    /* ── CSV Export ───────────────────────────────────────── */
    async function exportCsv(type, params) {
        const u = new URL('/api/admin/export/' + type, location.origin);
        Object.entries({ ...params, format: 'csv' }).forEach(([k, v]) => {
            if (v) u.searchParams.set(k, v);
        });
        const r = await fetch(u, { headers: { 'x-admin-token': token } });
        if (!r.ok) { toast('Export failed', 'error'); return; }
        if (r.status === 204) { toast('No data to export', 'info'); return; }
        const blob = await r.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${type}-${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
        toast('Export started!', 'success');
    }

    /* ── Chart cleanup ────────────────────────────────────── */
    function destroyCharts(keys) {
        keys.forEach((k) => { if (charts[k]) { charts[k].destroy(); delete charts[k]; } });
    }

    /* ── Bootstrap ────────────────────────────────────────── */
    if (token) {
        boot();
    } else {
        $('#login').hidden = false;
    }
})();