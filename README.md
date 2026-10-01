# 🔥 Usability Tracker

A drop-in, privacy-first usability analytics tool — your own self-hosted Hotjar/Clarity alternative.

Add **one `<script>` tag** to any website and get:
- 🔥 **Click, rage-click, dead-click, and mouse-movement heatmaps** with Shadow DOM overlay
- 📊 **Dashboard** with usability score, KPIs, insights, page-level analytics
- 🔀 **User flow** — entry/exit pages and page-to-page transitions  
- 🎬 **Session replay** — canvas-based mouse path visualizer
- 🚨 **Top usability problems** — auto-ranked by severity
- 📈 **Period comparisons** — current vs previous period deltas
- 🐞 **JS error tracking** and form field analytics
- ⬇ **CSV/JSON export** for every report
- 🌍 **Responsive dashboard** — desktop, tablet, mobile

---

## Quick Start

```bash
# 1. Clone / unzip and enter directory
cd usability_tracker

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env and change ADMIN_TOKEN to something secret

# 4. Start the server
npm start

# 5. (Optional) Seed demo data
npm run seed
```

Open **http://localhost:4000/dashboard/** and log in with your `ADMIN_TOKEN`.

---

## How to Use (Step-by-Step)

### Step 1: Add the Website to Your Dashboard
1. Open your dashboard at **http://localhost:4000/dashboard/** (or your production URL).
2. Log in using your `ADMIN_TOKEN`.
3. Click on the **⚙️ Install / Sites** tab.
4. Click the **"+ Add New Site"** button.
5. Enter a name for the website and its URL origin.
6. The dashboard will generate a unique `site_key` for that website.

### Step 2: Install the Tracking Script
1. In the **⚙️ Install / Sites** tab, copy the generated `<script>` snippet.
2. Paste this `<script>` tag into the HTML of the website you want to track (preferably before the closing `</head>` or `</body>` tag).

### Step 3: Let Users Interact
Once the script is live, it automatically runs in the background and records:
- Where visitors click and how far they scroll
- "Rage clicks" (clicking rapidly in frustration)
- "Dead clicks" (clicking on things that aren't actually links/buttons)
- Mouse movements and JavaScript errors
- Form interactions (without recording the actual typed values)

### Step 4: View the Analytics
1. Go back to your dashboard.
2. In the top-right corner, use the **Select site** dropdown to choose your website.
3. Browse the tabs to see the data (Overview, Problems, Flow, Sessions, etc.).

### Step 5: View the Live Heatmap
To see a visual heatmap directly overlayed on your website:
1. Go to any page on your website that has the script installed.
2. Add `?ut_admin=YOUR_TOKEN&ut_open=1` to the end of the URL and hit enter.
3. A control panel will appear in the bottom right corner, allowing you to toggle between click heatmaps, scroll depth, and more right on the live page.

---

## Embed on Any Website

```html
<script
  src="http://your-server:4000/tracker.js"
  data-site="YOUR_SITE_KEY"
  data-api="http://your-server:4000"
  defer
></script>
```

Find your `site_key` in **Dashboard → Install / Sites**.

### Optional Attributes

| Attribute | Default | Description |
|-----------|---------|-------------|
| `data-moves="off"` | on | Disable mouse movement tracking |
| `data-respect-dnt="true"` | false | Honour browser Do-Not-Track |
| `data-mask-text="true"` | false | Replace all text captures with `***` |
| `data-ut-ignore` | — | Add to any element to exclude from tracking |

### JavaScript API

```js
// Track a custom event
UsabilityTracker.track('purchase_complete', { plan: 'pro' });

// Opt out of all tracking (stored in localStorage)
UsabilityTracker.optOut();

// Opt back in
UsabilityTracker.optIn();

// Check opt-out status
UsabilityTracker.isOptedOut(); // → true/false
```

---

## Heatmap on Live Pages

Append `?ut_admin=YOUR_TOKEN&ut_open=1` to any tracked URL to activate the heatmap overlay:

```
https://yoursite.com/page?ut_admin=YOUR_TOKEN&ut_open=1
```

The floating panel (bottom-right corner) provides:
- Mode selector: Clicks / Rage / Dead / Mouse movement / Scroll depth
- Device filter, date range, opacity slider, top-N hotspots filter
- **Export PNG** — snapshot the current heatmap

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | HTTP port |
| `ADMIN_TOKEN` | `admin123` | Bearer token for dashboard/API |
| `DB_PATH` | `./data/usability.db` | SQLite database path |
| `RETENTION_DAYS` | `90` | Auto-purge data older than N days |
| `HMAC_SECRET` | *(built-in)* | Secret for short-lived heatmap tokens |
| `ADMIN_ORIGIN` | *(any)* | Lock admin API to a specific origin |

---

## NPM Scripts

```bash
npm start          # Start production server
npm run dev        # Start with --watch (auto-restart on file changes)
npm run seed       # Seed 1,500 demo sessions (30 days of fake data)
npm run seed:large # Seed 5,000 sessions
npm run build      # Minify tracker.js → tracker.min.js (49% smaller)
npm test           # Run 18 unit tests (node:test, no extra deps)
```

---

## API Reference

All admin endpoints require the header: `x-admin-token: YOUR_TOKEN`

### Common query parameters

| Param | Values | Description |
|-------|--------|-------------|
| `site` | site_key | **Required.** Target site |
| `range` | `24h` `7d` `30d` `90d` `all` | Date range |
| `device` | `all` `desktop` `tablet` `mobile` | Device filter |
| `path` | URL path | Page filter (heatmap, elements) |

### Endpoints

```
GET  /api/admin/ping                    Health check
GET  /api/admin/sites                   List sites
POST /api/admin/sites                   Create site {name, origin}
POST /api/admin/sites/:id/rotate-key    Rotate site key
GET  /api/admin/overview                KPIs, score, insights
GET  /api/admin/pages                   Per-page analytics
GET  /api/admin/timeseries              Daily views/sessions/clicks
GET  /api/admin/devices                 Device/browser/OS breakdown
GET  /api/admin/sessions                Recent sessions list
GET  /api/admin/sessions/:id            Session detail + events
GET  /api/admin/heatmap                 Heatmap points (click/rage/dead/move/scroll)
GET  /api/admin/elements                Top clicked elements
GET  /api/admin/errors                  JS error groups
GET  /api/admin/forms                   Form field analytics
GET  /api/admin/flow                    Entry/exit pages + transitions
GET  /api/admin/compare                 Current vs previous period
GET  /api/admin/top-problems            Auto-ranked usability issues
GET  /api/admin/export/:type            CSV/JSON export (add ?format=csv)
POST /api/admin/heatmap-token           Short-lived HMAC heatmap token
DELETE /api/admin/sites/:id/data        Delete all data for a site
POST /api/admin/sites/:id/purge         Purge data older than N days
```

### Collect endpoint (open — no auth)

```
POST /api/collect   Content-Type: text/plain   (used automatically by tracker.js)
```

---

## Privacy & Compliance

- ❌ **Never** captures input field values (only field names/IDs)
- ❌ **Never** captures password fields
- ❌ No third-party services, no cloud dependencies
- ✅ Respects `navigator.doNotTrack` when `data-respect-dnt="true"`
- ✅ `UsabilityTracker.optOut()` stores opt-out in `localStorage`
- ✅ `data-ut-ignore` attribute excludes any element from tracking
- ✅ `data-mask-text="true"` replaces all text captures with `***`
- ✅ Data retention: automatically purges data older than `RETENTION_DAYS`

---

## Docker

```bash
# Build and run
docker-compose up -d

# Or build manually
docker build -t usability-tracker .
docker run -p 4000:4000 -e ADMIN_TOKEN=my-secret -v ./data:/app/data usability-tracker
```

---

## Tests

```bash
npm test
```

18 unit tests covering: score algorithm, insights, pages, heatmap, flow, compare, top-problems, timeseries, purge. Uses Node.js built-in `node:test` — no extra test framework needed.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | Node.js + Express 5 |
| Database | SQLite via better-sqlite3 (WAL mode) |
| Tracker | Vanilla JavaScript (zero dependencies) |
| Heatmap overlay | Shadow DOM + Canvas |
| Dashboard | HTML + CSS + Chart.js 4 |
| Bundler | esbuild (minification only) |
| Tests | node:test (built-in) |

---

## Project Structure

```
usability_tracker/
├── server/
│   ├── index.js          # Express app entry
│   ├── config.js         # Env-based config
│   ├── db.js             # SQLite schema + migrations
│   ├── middleware/
│   │   └── auth.js       # Token auth + rate limiting
│   ├── routes/
│   │   ├── collect.js    # POST /api/collect
│   │   └── admin.js      # GET/POST /api/admin/*
│   └── services/
│       └── analytics.js  # All aggregation logic
├── public/
│   ├── tracker.js        # Embed script (source)
│   ├── tracker.min.js    # Minified (npm run build)
│   ├── heatmap.js        # Heatmap overlay (source)
│   ├── heatmap.min.js    # Minified
│   ├── dashboard/        # Admin dashboard SPA
│   │   ├── index.html
│   │   ├── dashboard.css
│   │   └── dashboard.js
│   └── demo/             # Demo site for testing
│       ├── index.html
│       └── pricing.html
├── scripts/
│   ├── build.js          # esbuild minification
│   └── seed.js           # Demo data generator
├── tests/
│   └── analytics.test.js # 18 unit tests
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── package.json
```