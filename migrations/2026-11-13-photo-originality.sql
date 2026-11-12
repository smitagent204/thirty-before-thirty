-- Отпечаток кадра (dHash 8×8, 16 hex-знаков) для поиска повторных загрузок.
ALTER TABLE photos ADD COLUMN fingerprint TEXT;
