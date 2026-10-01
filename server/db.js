const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { DB_PATH } = require('./config');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  site_key TEXT NOT NULL UNIQUE,
  origin TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  site_id INTEGER NOT NULL,
  visitor_id TEXT,
  device_type TEXT,
  browser TEXT,
  os TEXT,
  screen_w INTEGER, screen_h INTEGER,
  viewport_w INTEGER, viewport_h INTEGER,
  language TEXT,
  referrer TEXT,
  entry_path TEXT,
  started_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  page_count INTEGER DEFAULT 0,
  event_count INTEGER DEFAULT 0,
  is_new_visitor INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pageviews (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  site_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  title TEXT,
  device_type TEXT,
  doc_w INTEGER, doc_h INTEGER,
  started_at INTEGER NOT NULL,
  duration_ms INTEGER DEFAULT 0,
  active_ms INTEGER DEFAULT 0,
  max_scroll_pct INTEGER DEFAULT 0,
  load_time_ms INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  pageview_id TEXT NOT NULL,
  type TEXT NOT NULL,
  ts INTEGER NOT NULL,
  path TEXT,
  device_type TEXT,
  x_pct REAL,
  y INTEGER,
  selector TEXT,
  tag TEXT,
  text TEXT,
  extra TEXT
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_ev_main ON events(site_id, path, type, device_type, ts);
CREATE INDEX IF NOT EXISTS idx_ev_pv ON events(pageview_id);
CREATE INDEX IF NOT EXISTS idx_ev_sess ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_ev_type_ts ON events(site_id, type, ts);
CREATE INDEX IF NOT EXISTS idx_pv_main ON pageviews(site_id, path, started_at);
CREATE INDEX IF NOT EXISTS idx_pv_sess ON pageviews(session_id);
CREATE INDEX IF NOT EXISTS idx_pv_site_started ON pageviews(site_id, started_at);
CREATE INDEX IF NOT EXISTS idx_sess_main ON sessions(site_id, started_at);
CREATE INDEX IF NOT EXISTS idx_sess_visitor ON sessions(site_id, visitor_id);
CREATE INDEX IF NOT EXISTS idx_ev_site_ts ON events(site_id, ts);
`);

/* ---------- Safe migrations for existing DBs ---------- */
function addColumnIfMissing(table, column, def) {
    try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
        console.log(`[db] migrated: added ${table}.${column}`);
    } catch (e) {
        // Column already exists — ignore SQLITE_ERROR "duplicate column name"
        if (!e.message.includes('duplicate column')) throw e;
    }
}
addColumnIfMissing('sessions', 'is_new_visitor', 'INTEGER DEFAULT 1');
addColumnIfMissing('pageviews', 'load_time_ms', 'INTEGER DEFAULT 0');

// Seed demo site if no sites exist
if (!db.prepare('SELECT COUNT(*) c FROM sites').get().c) {
    db.prepare('INSERT INTO sites(name, site_key, origin, created_at) VALUES (?,?,?,?)')
        .run('Demo Site', 'demo_site_key_123', 'http://localhost:4000', Date.now());
}

module.exports = db;