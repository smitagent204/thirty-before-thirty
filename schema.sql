-- 30 до 30 · схема D1
-- Применить: npx wrangler d1 execute thirty-db --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS completions (
  telegram_id INTEGER NOT NULL,
  task_id TEXT NOT NULL,
  points INTEGER NOT NULL,
  manual INTEGER NOT NULL DEFAULT 0,
  photo_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (telegram_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_completions_user
  ON completions (telegram_id);

-- Храним только одобренные фото. base64, сжатые на клиенте.
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  telegram_id INTEGER NOT NULL,
  task_id TEXT NOT NULL,
  mime TEXT NOT NULL,
  image TEXT NOT NULL,
  score INTEGER NOT NULL,
  verdict TEXT NOT NULL,
  reason TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_photos_user_task
  ON photos (telegram_id, task_id);

CREATE TABLE IF NOT EXISTS app_state (
  telegram_id INTEGER PRIMARY KEY,
  chest_opened INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Чувствительный QR-приз: хранится только здесь и отдаётся через /api/prize
-- после открытия сундука. В public/ его класть нельзя.
CREATE TABLE IF NOT EXISTS prizes (
  id TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  image TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
