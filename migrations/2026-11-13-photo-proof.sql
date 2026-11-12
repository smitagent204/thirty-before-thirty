-- Доказательство оригинальности вторым кадром с другого ракурса.
ALTER TABLE photos ADD COLUMN proof_at TEXT;
ALTER TABLE photos ADD COLUMN proof_reason TEXT;
ALTER TABLE photos ADD COLUMN proof_prev_score INTEGER;
