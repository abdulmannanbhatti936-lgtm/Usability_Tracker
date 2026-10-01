/*! Usability Tracker v2.0 | Privacy-first, zero-dependency embed */
(function () {
    'use strict';
    if (window.__UT_LOADED__) return;
    window.__UT_LOADED__ = true;

    var script = document.currentScript || document.querySelector('script[data-site]');
    if (!script) return;

    var cfg = {
        site: script.getAttribute('data-site'),
        api: (script.getAttribute('data-api') || new URL(script.src, location.href).origin).replace(/\/$/, ''),
        moves: script.getAttribute('data-moves') !== 'off',
        dnt: script.getAttribute('data-respect-dnt') === 'true',
        maskText: script.getAttribute('data-mask-text') === 'true', // mask all text capture
    };
    if (!cfg.site) return;

    /* ---------- Admin mode: tracking off, heatmap UI on ---------- */
    try {
        var qs = new URLSearchParams(location.search);
        if (qs.get('ut_admin')) {
            sessionStorage.setItem('ut_admin', qs.get('ut_admin'));
            if (qs.get('ut_open')) sessionStorage.setItem('ut_hm_on', '1');
            qs.delete('ut_admin'); qs.delete('ut_open');
            history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs.toString() : '') + location.hash);
        }
    } catch (e) { }

    var adminToken = null;
    try { adminToken = sessionStorage.getItem('ut_admin'); } catch (e) { }
    if (adminToken) {
        window.__UT_CFG__ = { api: cfg.api, site: cfg.site, token: adminToken };
        var hs = document.createElement('script');
        hs.src = cfg.api + '/heatmap.js';
        document.head.appendChild(hs);
        return; // admin clicks not tracked
    }

    /* ---------- Privacy / opt-out ---------- */
    try { if (localStorage.getItem('ut_optout') === '1') return; } catch (e) { }
    if (cfg.dnt && (navigator.doNotTrack === '1' || window.doNotTrack === '1')) return;

    /* ---------- Helpers ---------- */
    function now() { return Date.now(); }
    function uid() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 3 | 8)).toString(16);
        });
    }
    function deviceType() {
        var w = window.innerWidth;
        return w < 768 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop';
    }
    function browser() {
        var u = navigator.userAgent;
        if (/Edg\//.test(u)) return 'Edge';
        if (/OPR\//.test(u)) return 'Opera';
        if (/Firefox\//.test(u)) return 'Firefox';
        if (/Chrome\//.test(u)) return 'Chrome';
        if (/Safari\//.test(u)) return 'Safari';
        return 'Other';
    }
    function os() {
        var u = navigator.userAgent;
        if (/Windows/.test(u)) return 'Windows';
        if (/Android/.test(u)) return 'Android';
        if (/iPhone|iPad|iPod/.test(u)) return 'iOS';
        if (/Mac OS X/.test(u)) return 'macOS';
        if (/Linux/.test(u)) return 'Linux';
        return 'Other';
    }
    function docW() {
        var b = document.body;
        return Math.max(document.documentElement.scrollWidth, b ? b.scrollWidth : 0, window.innerWidth);
    }
    function docH() {
        var b = document.body;
        return Math.max(
            document.documentElement.scrollHeight,
            b ? b.scrollHeight : 0,
            document.documentElement.offsetHeight
        );
    }
    function getVid() {
        try {
            var v = localStorage.getItem('ut_vid');
            if (!v) { v = uid(); localStorage.setItem('ut_vid', v); }
            return v;
        } catch (e) { return uid(); }
    }
    function getSession() {
        var t = now(), s = null;
        try { s = JSON.parse(sessionStorage.getItem('ut_sess') || 'null'); } catch (e) { }
        if (!s || t - s.last > 30 * 60 * 1000) s = { id: uid(), start: t, last: t };
        s.last = t;
        try { sessionStorage.setItem('ut_sess', JSON.stringify(s)); } catch (e) { }
        return s;
    }
    function selector(el) {
        if (!el) return 'body';
        var parts = [], depth = 0;
        while (el && el.nodeType === 1 && el !== document.body && depth < 5) {
            var p = el.tagName.toLowerCase();
            if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) { parts.unshift(p + '#' + el.id); break; }
            var cls = (typeof el.className === 'string' ? el.className.trim().split(/\s+/) : [])
                .filter(function (c) { return /^[A-Za-z_][\w-]*$/.test(c) && c.length < 30; })
                .slice(0, 2);
            if (cls.length) p += '.' + cls.join('.');
            if (el.parentElement) {
                var sib = Array.prototype.filter.call(
                    el.parentElement.children,
                    function (c) { return c.tagName === el.tagName; }
                );
                if (sib.length > 1) p += ':nth-of-type(' + (Array.prototype.indexOf.call(sib, el) + 1) + ')';
            }
            parts.unshift(p);
            el = el.parentElement;
            depth++;
        }
        return parts.join(' > ') || 'body';
    }
    function maskStr(s) {
        return cfg.maskText ? '***' : s;
    }
    function safeText(el) {
        if (cfg.maskText) return '***';
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
            // NEVER capture input values, only field names/ids
            return (el.name || el.id || el.type || '').slice(0, 60);
        }
        return (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    }
    function ignored(el) { return !!(el.closest && el.closest('[data-ut-ignore]')); }

    /* ---------- State ---------- */
    var queue = [], pv = null, vid = getVid();
    var activeMs = 0, lastActivity = now(), mutationCount = 0;
    var recentClicks = [], lastRage = 0, lastMove = 0, lastMoveXY = { x: -100, y: -100 };
    var fieldState = null;
    var retryQueue = [], retryTimeout = null;

    function readLoad() {
        try {
            var n = performance.getEntriesByType('navigation')[0];
            if (n && n.loadEventEnd > 0) return Math.round(n.loadEventEnd);
        } catch (e) { }
        return 0;
    }

    function startPage(first) {
        pv = {
            id: uid(), path: location.pathname + location.search,
            title: (document.title || '').slice(0, 150),
            start: now(), maxScroll: 0, load: 0, moves: 0,
            device: deviceType(), sess: getSession(),
        };
        activeMs = 0; recentClicks = [];
        if (first) {
            var setLoad = function () {
                setTimeout(function () { if (pv) pv.load = readLoad(); }, 50);
            };
            if (document.readyState === 'complete') setLoad();
            else window.addEventListener('load', setLoad, { once: true });
        }
        onScroll();
    }

    function push(type, px, py, info, extra) {
        if (!pv) return;
        var e = { t: type, ts: now() };
        if (px != null) {
            e.x = parseFloat((px / Math.max(1, docW())).toFixed(4));
            e.y = Math.round(py);
        }
        if (info) {
            e.sel = info.sel;
            e.tag = info.tag;
            e.txt = cfg.maskText ? '***' : info.txt;
        }
        if (extra) e.ex = extra;
        queue.push(e);
        if (queue.length > 1000) queue.shift(); // cap queue
    }

    function payload(events) {
        var s = pv.sess;
        return JSON.stringify({
            k: cfg.site,
            s: {
                id: s.id, vid: vid, device: pv.device,
                browser: browser(), os: os(),
                sw: screen.width, sh: screen.height,
                vw: window.innerWidth, vh: window.innerHeight,
                lang: navigator.language,
                ref: (document.referrer || '').slice(0, 300),
                start: s.start,
            },
            p: {
                id: pv.id, path: pv.path, title: pv.title,
                dw: docW(), dh: docH(), load: pv.load,
                dur: now() - pv.start, scroll: pv.maxScroll,
                active: activeMs, start: pv.start,
            },
            e: events,
        });
    }

    function flush(useBeacon) {
        if (!pv || document.visibilityState === 'hidden' && !useBeacon) return;
        if (!pv) return;
        var ev = queue.splice(0, queue.length);
        if (!ev.length && !useBeacon) return; // nothing to send unless it's a final beacon
        var body = payload(ev);
        var url = cfg.api + '/api/collect';

        if (useBeacon && navigator.sendBeacon) {
            try {
                if (navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) return;
            } catch (e) { }
        }

        // Retry with exponential backoff
        var attempt = 0;
        function send() {
            try {
                fetch(url, {
                    method: 'POST', body: body,
                    headers: { 'Content-Type': 'text/plain' },
                    keepalive: true, mode: 'cors',
                }).then(function (r) {
                    if (!r.ok && attempt < 3) {
                        attempt++;
                        setTimeout(send, Math.pow(2, attempt) * 1000);
                    }
                }).catch(function () {
                    if (attempt < 3) {
                        attempt++;
                        setTimeout(send, Math.pow(2, attempt) * 1000);
                    }
                });
            } catch (e) { }
        }
        send();
    }

    /* ---------- Scroll depth ---------- */
    var scrollTick = false;
    function onScroll() {
        if (scrollTick) return;
        scrollTick = true;
        requestAnimationFrame(function () {
            scrollTick = false;
            if (!pv) return;
            var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            var pct = Math.min(100, Math.round((scrollTop + window.innerHeight) / Math.max(1, docH()) * 100));
            if (pct > pv.maxScroll) pv.maxScroll = pct;
        });
    }
    window.addEventListener('scroll', function () { activity(); onScroll(); }, { passive: true });

    /* ---------- Activity / active time ---------- */
    function activity() { lastActivity = now(); }
    setInterval(function () {
        if (document.visibilityState === 'visible' && now() - lastActivity < 10000) {
            activeMs += 1000;
        }
    }, 1000);

    /* ---------- DOM mutation watcher (dead click detection) ---------- */
    try {
        new MutationObserver(function (m) { mutationCount += m.length; })
            .observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    } catch (e) { }

    /* ---------- Clicks, rage clicks, dead clicks ---------- */
    document.addEventListener('click', function (ev) {
        activity();
        var el = ev.target;
        if (!(el instanceof Element) || ignored(el)) return;

        var t = el.closest('a,button,input,select,textarea,label,summary,[role="button"],[onclick]') || el;
        var px = ev.pageX, py = ev.pageY;

        // Handle keyboard-triggered clicks (detail=0)
        if (ev.detail === 0 || (px === 0 && py === 0)) {
            var r = t.getBoundingClientRect();
            px = r.left + r.width / 2 + window.pageXOffset;
            py = r.top + r.height / 2 + window.pageYOffset;
        }

        var txt = safeText(t);
        var info = { sel: selector(t), tag: t.tagName.toLowerCase(), txt: txt };
        push('click', px, py, info);

        // Rage click: 3+ clicks within 1s, 40px radius
        var tn = now();
        recentClicks.push({ t: tn, x: px, y: py });
        recentClicks = recentClicks.filter(function (c) { return tn - c.t < 1000; });
        if (recentClicks.length >= 3) {
            var f = recentClicks[0];
            var close = recentClicks.every(function (c) {
                return Math.hypot(c.x - f.x, c.y - f.y) < 40;
            });
            if (close && tn - lastRage > 2000) { lastRage = tn; push('rage_click', px, py, info); }
        }

        // Dead click: clickable-looking element, nothing happened in 700ms
        // Excludes: links, actual form inputs, form submits
        var looksClickable = (
            t.matches('button:not([type="submit"]),[role="button"],summary,[onclick]') ||
            (!t.matches('a[href],input,select,textarea,label') && getComputedStyle(t).cursor === 'pointer')
        ) && !t.disabled;

        if (looksClickable) {
            var m0 = mutationCount, u0 = location.href, y0 = window.pageYOffset;
            var p0 = pv && pv.id;
            setTimeout(function () {
                if (pv && pv.id === p0 && mutationCount === m0 &&
                    location.href === u0 && Math.abs(window.pageYOffset - y0) < 5) {
                    push('dead_click', px, py, info);
                }
            }, 700);
        }
    }, true);

    /* ---------- Mouse movement (sampled, paused when tab hidden) ---------- */
    if (cfg.moves) {
        document.addEventListener('mousemove', function (ev) {
            if (document.visibilityState === 'hidden') return;
            activity();
            var t = now();
            if (t - lastMove < 150 || !pv || pv.moves >= 400) return;
            if (Math.hypot(ev.pageX - lastMoveXY.x, ev.pageY - lastMoveXY.y) < 12) return;
            lastMove = t;
            lastMoveXY = { x: ev.pageX, y: ev.pageY };
            pv.moves++;
            push('move', ev.pageX, ev.pageY);
        }, { passive: true });
    }
    ['keydown', 'touchstart'].forEach(function (n) {
        document.addEventListener(n, activity, { passive: true });
    });

    /* ---------- JS errors ---------- */
    window.addEventListener('error', function (e) {
        if (!e.message) return;
        var msg = (e.message + ' @' + String(e.filename || '').split('/').pop() + ':' + (e.lineno || 0)).slice(0, 200);
        push('error', null, null, { sel: '', tag: '', txt: maskStr(msg) });
    });
    window.addEventListener('unhandledrejection', function (e) {
        var r = e.reason;
        var msg = ('Unhandled rejection: ' + (r && r.message || r)).slice(0, 200);
        push('error', null, null, { sel: '', tag: '', txt: maskStr(msg) });
    });

    /* ---------- Forms (field names + timing only, VALUES are NEVER captured) ---------- */
    var FIELD = /^(INPUT|TEXTAREA|SELECT)$/;
    document.addEventListener('focusin', function (e) {
        var el = e.target;
        if (!FIELD.test(el.tagName) || el.type === 'hidden' || el.type === 'password' || ignored(el)) return;
        fieldState = { el: el, start: now(), changed: false };
    });
    document.addEventListener('input', function (e) {
        if (fieldState && fieldState.el === e.target) fieldState.changed = true;
    });
    document.addEventListener('change', function (e) {
        if (fieldState && fieldState.el === e.target) fieldState.changed = true;
    });
    document.addEventListener('focusout', function (e) {
        if (!fieldState || fieldState.el !== e.target) return;
        var el = fieldState.el;
        // Never capture value; only field identifier
        var fieldName = (el.name || el.id || el.type || 'field').slice(0, 60);
        push('form_field', null, null,
            { sel: selector(el), tag: el.tagName.toLowerCase(), txt: maskStr(fieldName) },
            { type: el.type || el.tagName.toLowerCase(), ms: now() - fieldState.start, changed: fieldState.changed ? 1 : 0 }
        );
        fieldState = null;
    });
    document.addEventListener('submit', function (e) {
        var f = e.target;
        if (!f || !f.tagName || ignored(f)) return;
        var formId = (f.id || f.name || 'form').slice(0, 60);
        push('form_submit', null, null,
            { sel: selector(f), tag: 'form', txt: maskStr(formId) }
        );
        flush(true);
    }, true);

    /* ---------- SPA support ---------- */
    function onRoute() {
        var newPath = location.pathname + location.search;
        if (pv && newPath === pv.path) return;
        flush(true);
        startPage(false);
    }
    ['pushState', 'replaceState'].forEach(function (m) {
        var orig = history[m];
        history[m] = function () {
            var r = orig.apply(this, arguments);
            setTimeout(onRoute, 0);
            return r;
        };
    });
    window.addEventListener('popstate', onRoute);

    /* ---------- Lifecycle ---------- */
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') flush(true);
    });
    window.addEventListener('pagehide', function () { flush(true); });

    // Periodic flush every 8s (only when tab is visible)
    setInterval(function () {
        if (document.visibilityState === 'visible') flush(false);
    }, 8000);

    // Initial page setup
    startPage(true);
    setTimeout(function () { flush(false); }, 1500);

    /* ---------- Public API ---------- */
    window.UsabilityTracker = {
        /**
         * Track a custom event.
         * @param {string} name - Event name (max 100 chars)
         * @param {object} [data] - Optional extra data
         */
        track: function (name, data) {
            push('custom', null, null, { sel: '', tag: '', txt: String(name).slice(0, 100) }, data || null);
        },
        /**
         * Opt out of tracking — stored in localStorage.
         */
        optOut: function () {
            try { localStorage.setItem('ut_optout', '1'); } catch (e) { }
            queue = [];
            pv = null;
        },
        /**
         * Opt back in after optOut().
         */
        optIn: function () {
            try { localStorage.removeItem('ut_optout'); } catch (e) { }
        },
        /**
         * Check if currently opted out.
         */
        isOptedOut: function () {
            try { return localStorage.getItem('ut_optout') === '1'; } catch (e) { return false; }
        },
    };
})();