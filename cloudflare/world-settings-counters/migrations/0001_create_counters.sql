CREATE TABLE IF NOT EXISTS counters (
  id TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0),
  downloads INTEGER NOT NULL DEFAULT 0 CHECK (downloads >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO counters (id, views, downloads)
VALUES ('world-settings', 567, 438)
ON CONFLICT(id) DO NOTHING;
