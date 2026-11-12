-- Что было до апелляции: исходные минусы и ответ ИИ на пересмотр.
-- Нужны, чтобы человек мог открыть апелляцию и увидеть, что оспаривал.
ALTER TABLE photos ADD COLUMN appeal_prev_deductions TEXT;
ALTER TABLE photos ADD COLUMN appeal_reason TEXT;
