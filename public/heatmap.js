/*! Usability Heatmap Overlay v2.0 (admin only) — Shadow DOM UI, zero dependencies */
(function () {
    'use strict';
    var C = window.__UT_CFG__;
    if (!C || window.__UT_HM__) return;
    window.__UT_HM__ = true;

    var state = {
        on: false, mode: 'click', device: 'auto', range: '30d',
        canvas: null, badges: null, lastH: 0, lastPath: location.pathname,
        opacity: 0.75, topN: 0, // 0 = all
    };
    var host, root, el = {};

    /* ---------- API helper ---------- */
    function api(path, params) {
        var u = new URL(C.api + '/api/admin/' + path);
        Object.keys(params || {}).forEach(function (k) { u.searchParams.set(k, params[k]); });
        return fetch(u, { headers: { 'x-admin-token': C.token } }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        });
    }

    function curDevice() {
        var w = innerWidth;
        return w < 768 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop';
    }
    function docW() {
        return Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0, innerWidth);
    }
    function docH() {
        return Math.max(
            document.documentElement.scrollHeight,
            document.body ? document.body.scrollHeight : 0,
            document.documentElement.offsetHeight
        );
    }

    /* ---------- Colour palette (cold → hot) ---------- */
    var pal = (function () {
        var c = document.createElement('canvas');
        c.width = 256; c.height = 1;
        var x = c.getContext('2d');
        var g = x.createLinearGradient(0, 0, 256, 0);
        g.addColorStop(0, 'rgb(0,0,255)');
        g.addColorStop(0.25, 'rgb(0,200,255)');
        g.addColorStop(0.5, 'rgb(0,255,80)');
        g.addColorStop(0.75, 'rgb(255,255,0)');
        g.addColorStop(1, 'rgb(255,0,0)');
        x.fillStyle = g;
        x.fillRect(0, 0, 256, 1);
        return x.getImageData(0, 0, 256, 1).data;
    })();

    function brush(r) {
        var c = document.createElement('canvas');
        c.width = c.height = r * 2;
        var x = c.getContext('2d');
        var g = x.createRadialGradient(r, r, 0, r, r, r);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g;
        x.fillRect(0, 0, r * 2, r * 2);
        return c;
    }

    /* ---------- Shadow DOM UI ---------- */
    var STYLE = [
        '*{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}',
        '.toggle{position:fixed;right:16px;bottom:16px;display:flex;align-items:center;gap:10px;',
        'background:#111827;color:#fff;border:0;border-radius:999px;padding:10px 16px 10px 12px;',
        'cursor:pointer;font-size:14px;box-shadow:0 6px 20px rgba(0,0,0,.35);z-index:2147483647}',
        '.sw{width:38px;height:22px;border-radius:999px;background:#4b5563;position:relative;transition:.2s}',
        '.sw::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;',
        'border-radius:50%;background:#fff;transition:.2s}',
        '.on .sw{background:#ef4444}.on .sw::after{left:19px}',
        '.panel{position:fixed;right:16px;bottom:68px;width:300px;background:#111827;color:#e5e7eb;',
        'border-radius:14px;padding:14px;font-size:13px;box-shadow:0 10px 30px rgba(0,0,0,.4);',
        'display:none;z-index:2147483646;max-height:90vh;overflow-y:auto}',
        '.panel.show{display:block}',
        'h4{margin:0 0 10px;font-size:14px;color:#fff;display:flex;align-items:center;gap:6px}',
        'label{display:block;margin:8px 0 3px;color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:.05em}',
        'select,input[type=range]{width:100%;border-radius:8px;border:1px solid #374151;background:#1f2937;color:#fff}',
        'select{padding:7px}',
        'input[type=range]{-webkit-appearance:none;appearance:none;height:6px;outline:none;accent-color:#ef4444;padding:0}',
        '.row2{display:flex;gap:8px}',
        '.row2 select{flex:1}',
        '.btn-sm{flex:1;padding:6px 10px;border:0;border-radius:8px;background:#374151;color:#e5e7eb;',
        'font-size:12px;cursor:pointer;font-weight:600;text-align:center}',
        '.btn-sm:hover{background:#4b5563}',
        '.btn-danger{background:#7f1d1d;color:#fca5a5}',
        '.legend{height:10px;border-radius:6px;margin-top:10px;',
        'background:linear-gradient(90deg,#00f,#0cf,#0f5,#ff0,#f00)}',
        '.lg{display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;margin-top:3px}',
        '.stat{margin-top:10px;line-height:1.6;color:#d1d5db;font-size:12px}',
        '.stat b{color:#fff}',
        '.err{color:#fca5a5}',
        'hr{border:0;border-top:1px solid #374151;margin:10px 0}',
        '.val-lbl{color:#fff;float:right;font-size:12px}',
    ].join('');

    function buildUI() {
        host = document.createElement('div');
        host.setAttribute('data-ut-ignore', '');
        host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
        document.body.appendChild(host);
        root = host.attachShadow({ mode: 'open' });

        root.innerHTML = '<style>' + STYLE + '</style>' +
            '<button class="toggle" id="t" style="pointer-events:all">' +
            '<span class="sw"></span><span>🔥 Heatmap</span></button>' +
            '<div class="panel" id="p" style="pointer-events:all">' +
            '<h4>🔥 Heatmap Controls</h4>' +
            '<label>Type</label>' +
            '<select id="mode">' +
            '<option value="click">Clicks</option>' +
            '<option value="rage">Rage clicks</option>' +
            '<option value="dead">Dead clicks</option>' +
            '<option value="move">Mouse movement</option>' +
            '<option value="scroll">Scroll depth</option>' +
            '</select>' +
            '<label>Device</label>' +
            '<select id="dev">' +
            '<option value="auto">Auto (this screen)</option>' +
            '<option value="all">All devices</option>' +
            '<option value="desktop">Desktop</option>' +
            '<option value="tablet">Tablet</option>' +
            '<option value="mobile">Mobile</option>' +
            '</select>' +
            '<label>Period</label>' +
            '<select id="range">' +
            '<option value="24h">Last 24 hours</option>' +
            '<option value="7d">Last 7 days</option>' +
            '<option value="30d" selected>Last 30 days</option>' +
            '<option value="90d">Last 90 days</option>' +
            '<option value="all">All time</option>' +
            '</select>' +
            '<label>Opacity <span class="val-lbl" id="opLbl">75%</span></label>' +
            '<input type="range" id="opacity" min="10" max="100" value="75">' +
            '<label>Show top N hotspots (0 = all)</label>' +
            '<input type="range" id="topn" min="0" max="50" value="0">' +
            '<span class="val-lbl" id="topLbl" style="font-size:12px;color:#9ca3af">All</span>' +
            '<hr>' +
            '<div class="row2">' +
            '<button class="btn-sm" id="reload">⟳ Reload</button>' +
            '<button class="btn-sm" id="exportBtn">📷 Export PNG</button>' +
            '</div>' +
            '<div class="legend"></div>' +
            '<div class="lg"><span>Cold</span><span>Hot</span></div>' +
            '<div class="stat" id="stat"></div>' +
            '</div>';

        el.t = root.getElementById('t');
        el.p = root.getElementById('p');
        el.stat = root.getElementById('stat');
        el.mode = root.getElementById('mode');
        el.dev = root.getElementById('dev');
        el.range = root.getElementById('range');
        el.opacity = root.getElementById('opacity');
        el.topn = root.getElementById('topn');
        el.opLbl = root.getElementById('opLbl');
        el.topLbl = root.getElementById('topLbl');
        el.reload = root.getElementById('reload');
        el.exportBtn = root.getElementById('exportBtn');

        el.t.addEventListener('click', function () { setOn(!state.on); });
        el.mode.addEventListener('change', function () { state.mode = el.mode.value; load(); });
        el.dev.addEventListener('change', function () { state.device = el.dev.value; load(); });
        el.range.addEventListener('change', function () { state.range = el.range.value; load(); });
        el.opacity.addEventListener('input', function () {
            state.opacity = el.opacity.value / 100;
            el.opLbl.textContent = el.opacity.value + '%';
            applyOpacity();
        });
        el.topn.addEventListener('input', function () {
            state.topN = parseInt(el.topn.value, 10);
            el.topLbl.textContent = state.topN === 0 ? 'All' : 'Top ' + state.topN;
            load();
        });
        el.reload.addEventListener('click', function () { load(); });
        el.exportBtn.addEventListener('click', exportPNG);
    }

    function applyOpacity() {
        if (state.canvas) {
            state.canvas.style.opacity = state.opacity;
        }
    }

    function setOn(v) {
        state.on = v;
        try { sessionStorage.setItem('ut_hm_on', v ? '1' : '0'); } catch (e) { }
        el.t.classList.toggle('on', v);
        el.p.classList.toggle('show', v);
        if (v) { ensureCanvas(); load(); } else { clearAll(); }
    }

    function ensureCanvas() {
        if (!state.canvas) {
            var c = document.createElement('canvas');
            c.setAttribute('data-ut-ignore', '');
            c.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;' +
                'z-index:2147483000;opacity:' + state.opacity;
            document.documentElement.appendChild(c);
            state.canvas = c;

            var b = document.createElement('div');
            b.setAttribute('data-ut-ignore', '');
            b.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483001';
            document.documentElement.appendChild(b);
            state.badges = b;
        }
    }

    function clearAll() {
        if (state.canvas) { state.canvas.remove(); state.canvas = null; }
        if (state.badges) { state.badges.remove(); state.badges = null; }
        el.stat.textContent = '';
    }

    /* ---------- Export PNG ---------- */
    function exportPNG() {
        if (!state.canvas) { el.stat.textContent = 'No heatmap to export. Enable heatmap first.'; return; }
        try {
            var link = document.createElement('a');
            link.download = 'heatmap-' + location.pathname.replace(/\//g, '-').replace(/^-/, '') + '-' + state.mode + '.png';
            link.href = state.canvas.toDataURL('image/png');
            link.click();
        } catch (e) {
            el.stat.className = 'stat err';
            el.stat.textContent = 'Export failed: ' + e.message;
        }
    }

    /* ---------- Data loading ---------- */
    function load() {
        if (!state.on) return;
        var dev = state.device === 'auto' ? curDevice() : state.device;
        el.stat.className = 'stat';
        el.stat.textContent = 'Loading…';
        state.lastPath = location.pathname;
        var params = {
            site: C.site,
            path: location.pathname,
            type: state.mode,
            device: dev === 'all' ? '' : dev,
            range: state.range,
        };
        if (params.device === '') delete params.device;

        api('heatmap', params).then(function (d) {
            render(d);
            summary(d);
            if (state.mode === 'click' || state.mode === 'rage' || state.mode === 'dead') {
                return api('elements', { ...params, device: dev }).then(function (rows) {
                    drawBadges(rows);
                });
            }
            if (state.badges) state.badges.innerHTML = '';
        }).catch(function (e) {
            el.stat.className = 'stat err';
            el.stat.textContent = 'Error: ' + e.message;
        });
    }

    function summary(d) {
        var html;
        if (d.type === 'scroll') {
            html = '<b>' + d.views + '</b> page views · avg scroll depth <b>' + d.avgScroll + '%</b>';
        } else {
            var label = { click: 'clicks', rage: 'rage clicks', dead: 'dead clicks', move: 'mouse points' }[d.type] || d.type;
            html = '<b>' + (d.total || 0) + '</b> ' + label + ' · <b>' + d.views + '</b> page views';
            if (!d.total) html += ' <span style="color:#fbbf24">(no data for this filter)</span>';
        }
        el.stat.innerHTML = html;
    }

    /* ---------- Canvas rendering ---------- */
    function render(d) {
        if (!state.canvas) return;
        var W = docW(), H = docH();
        // Scale down canvas for very large pages to save memory
        var area = W * H;
        var sc = area > 5e6 ? Math.sqrt(5e6 / area) : 1;
        var cv = state.canvas;
        cv.width = Math.ceil(W * sc);
        cv.height = Math.ceil(H * sc);
        cv.style.width = W + 'px';
        cv.style.height = H + 'px';
        state.lastH = H;
        applyOpacity();

        var ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, cv.width, cv.height);

        if (d.type === 'scroll') return renderScroll(ctx, d, W, H, sc);

        var points = d.points || [];
        // Apply top-N filter
        if (state.topN > 0) points = points.slice(0, state.topN);
        if (!points.length) return;

        var r = Math.max(6, Math.round((d.type === 'move' ? 22 : 32) * sc));
        var b = brush(r);
        var max = d.max || points[0].c || 1;
        var k = d.type === 'move' ? 0.3 : 0.55;

        points.forEach(function (p) {
            ctx.globalAlpha = Math.max(0.06, p.c / max) * k;
            // x is relative (0-1), so multiply by W; y is absolute pixel
            ctx.drawImage(b, p.x * W * sc - r, p.y * sc - r);
        });
        ctx.globalAlpha = 1;

        // Apply heat colour palette
        var img = ctx.getImageData(0, 0, cv.width, cv.height);
        var px = img.data;
        for (var i = 3; i < px.length; i += 4) {
            var a = px[i];
            if (a) {
                var o = Math.min(255, a) * 4;
                px[i - 3] = pal[o];
                px[i - 2] = pal[o + 1];
                px[i - 1] = pal[o + 2];
                px[i] = Math.min(230, a * 1.3 + 30);
            }
        }
        ctx.putImageData(img, 0, 0);
    }

    function renderScroll(ctx, d, W, H, sc) {
        ctx.setTransform(sc, 0, 0, sc, 0, 0);
        (d.reach || []).forEach(function (b) {
            var idx = Math.round(b.pct / 100 * 255) * 4;
            ctx.fillStyle = 'rgba(' + pal[idx] + ',' + pal[idx + 1] + ',' + pal[idx + 2] + ',0.38)';
            var y = (b.depth / 100) * H;
            var h = H * 0.05;
            ctx.fillRect(0, y, W, h + 1);
            // Label
            ctx.fillStyle = 'rgba(17,24,39,.85)';
            ctx.fillRect(8, y + 6, 180, 24);
            ctx.fillStyle = '#fff';
            ctx.font = '600 13px system-ui,sans-serif';
            ctx.fillText(b.pct + '% of users reached ' + b.depth + '%', 14, y + 23);
        });
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    function drawBadges(rows) {
        if (!state.badges) return;
        state.badges.innerHTML = '';
        var total = rows.reduce(function (a, r) { return a + r.clicks; }, 0) || 1;
        var key = state.mode === 'rage' ? 'rage' : state.mode === 'dead' ? 'dead' : 'clicks';
        var filtered = rows.filter(function (r) { return r[key] > 0; });
        if (state.topN > 0) filtered = filtered.slice(0, state.topN);

        filtered.slice(0, 15).forEach(function (r) {
            var node;
            try { node = document.querySelector(r.selector); } catch (e) { return; }
            if (!node) return;
            var rc = node.getBoundingClientRect();
            var badge = document.createElement('div');
            badge.style.cssText = [
                'position:absolute',
                'background:#111827',
                'color:#fff',
                'font:600 11px system-ui,sans-serif',
                'padding:3px 7px',
                'border-radius:999px',
                'white-space:nowrap',
                'box-shadow:0 2px 8px rgba(0,0,0,.4)',
                'border:1px solid #fff3',
                'left:' + Math.round(rc.right + window.pageXOffset - 6) + 'px',
                'top:' + Math.round(rc.top + window.pageYOffset - 10) + 'px',
                'transform:translateX(-100%)',
            ].join(';');
            var val = r[key];
            badge.textContent = key === 'clicks'
                ? val + ' clicks (' + Math.round(val / total * 100) + '%)'
                : key === 'rage'
                    ? val + ' rage'
                    : val + ' dead';
            state.badges.appendChild(badge);
        });
    }

    /* ---------- Sync overlay when page changes ---------- */
    var resizeTimer;
    window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(load, 300);
    });
    setInterval(function () {
        if (!state.on) return;
        if (location.pathname !== state.lastPath) return load();
        if (Math.abs(docH() - state.lastH) > 20) load();
    }, 1200);

    /* ---------- Init: verify admin token then build UI ---------- */
    function init() {
        api('ping').then(function () {
            buildUI();
            var on = false;
            try { on = sessionStorage.getItem('ut_hm_on') === '1'; } catch (e) { }
            if (on) setOn(true);
        }).catch(function () {
            // Token invalid/expired — clear it
            try { sessionStorage.removeItem('ut_admin'); } catch (e) { }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();