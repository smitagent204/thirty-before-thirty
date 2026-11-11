-- 30 до 30 · структурированные минусы фото
-- Применить один раз: npx wrangler d1 execute thirty-db --remote --file=./migrations/2026-11-11-photo-deductions.sql
-- Для локальной базы добавь --local.

ALTER TABLE photos ADD COLUMN deductions TEXT NOT NULL DEFAULT '[]';
