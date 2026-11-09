import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { LEVEL_BY_ID } from '@shared/levels';
import type { AiVerdict, Task, TaskStatus } from '@shared/types';
import { impact, notify } from '../telegram/useTelegram';
import { ManualApprovalSheet } from './ManualApprovalSheet';

type Phase = 'idle' | 'checking' | 'pass' | 'fail';

interface TaskDetailsSheetProps {
  task: Task;
  status: TaskStatus;
  isDev: boolean;
  isManual: boolean;
  forceFail: boolean;
  onClose: () => void;
  onComplete: (taskId: string) => void;
  onManualComplete: (taskId: string) => void;
}

export function TaskDetailsSheet({
  task,
  status,
  isDev,
  isManual,
  forceFail,
  onClose,
  onComplete,
  onManualComplete,
}: TaskDetailsSheetProps) {
  const level = LEVEL_BY_ID.get(task.level);
  const [phase, setPhase] = useState<Phase>('idle');
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<AiVerdict | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const pickFile = (file: File | null) => {
    if (!file) return;
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    setFileName(file.name);
    setPhase('idle');
    setVerdict(null);
  };

  const checkPhoto = () => {
    if (!preview) return;
    impact('medium');
    setPhase('checking');
    timer.current = window.setTimeout(() => {
      if (forceFail) {
        setVerdict({
          score: 38,
          verdict: 'fail',
          reason:
            'На кадре не видно того, что просит задание. Попробуй снять ближе и так, чтобы в кадр попал результат.',
          confidence: 0.74,
        });
        setPhase('fail');
        notify('error');
        return;
      }
      const score = 78 + Math.floor(Math.random() * 16);
      setVerdict({
        score,
        verdict: 'pass',
        reason: 'Кадр соответствует заданию: видно всё, что нужно. Отличная работа!',
        confidence: 0.86,
      });
      setPhase('pass');
      notify('success');
    }, 1700);
  };

  const collect = () => {
    onComplete(task.id);
    notify('success');
    onClose();
  };

  const devComplete = () => {
    onComplete(task.id);
    onClose();
  };

  const done = status === 'completed';

  return (
    <motion.div
      className="sheet-layer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="scrim" onClick={onClose} />
        <motion.div
          className="sheet"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 32, stiffness: 340 }}
        >
          <div className="sheet__handle" />
          <div className="sheet__head">
            <div className="sheet__head-text">
              <div className="sheet__eyebrow">
                <span className="rarity" style={{ '--rarity': 'var(--c-gold-500)' } as CSSProperties}>
                  {level?.emoji} {level?.rarityLabel}
                </span>
                <span className="points">+{task.points}</span>
              </div>
              <h3 className="sheet__title">{task.title}</h3>
            </div>
            <button type="button" className="sheet__close" onClick={onClose} aria-label="Закрыть">
              ✕
            </button>
          </div>

          <div className="sheet__body">
            <p className="sheet__text">{task.description}</p>

            <section className="sheet__section">
              <h4 className="sheet__section-title">
                <span aria-hidden="true">📸</span> Что должно быть на фото
              </h4>
              <p className="sheet__hint">{task.photoHint}</p>
            </section>

            {done ? (
              <section className="sheet__section">
                <h4 className="sheet__section-title">
                  <span aria-hidden="true">✓</span> Задание выполнено
                </h4>
                <p className="sheet__hint">
                  {isManual
                    ? 'Задание засчитано вручную — фото не требовалось.'
                    : 'Фото проверено, баллы зачислены.'}
                </p>
              </section>
            ) : (
              <>
                <section className="sheet__section">
                  <h4 className="sheet__section-title">
                    <span aria-hidden="true">📷</span> Подтверждение
                  </h4>
                  <div className={`dropzone${phase === 'checking' ? ' is-checking' : ''}`}>
                    {preview ? (
                      <img className="dropzone__preview" src={preview} alt="Выбранное фото" />
                    ) : (
                      <>
                        <span className="dropzone__icon" aria-hidden="true">
                          🖼️
                        </span>
                        <span className="dropzone__title">Добавить фото</span>
                        <span className="dropzone__hint">
                          Нажми, чтобы снять или выбрать из галереи
                        </span>
                      </>
                    )}
                    <input
                      ref={inputRef}
                      className="photo-input"
                      type="file"
                      accept="image/*"
                      onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
                      aria-label="Загрузить фото"
                    />
                  </div>
                  {fileName && <p className="dev-note">Выбрано: {fileName}</p>}

                  {phase === 'checking' && (
                    <div className="checking">
                      <span className="checking__spinner" aria-hidden="true" />
                      <span className="checking__text">Проверяем кадр…</span>
                    </div>
                  )}

                  {verdict && (
                    <div
                      className={`verdict ${verdict.verdict === 'pass' ? 'verdict--pass' : 'verdict--fail'}`}
                      aria-live="polite"
                    >
                      <span className="verdict__score">{verdict.score}%</span>
                      <span>{verdict.reason}</span>
                    </div>
                  )}
                </section>
              </>
            )}

            <div className="sheet__meta">
              <span className="meta-chip">🏅 {task.points} баллов</span>
              <span className="meta-chip">🌿 Уровень {task.level}</span>
              {done && <span className="meta-chip meta-chip--done">✓ Выполнено</span>}
              {done && isManual && <span className="meta-chip">🔑 Засчитано вручную</span>}
            </div>
          </div>

          <div className="sheet__footer">
            {done ? (
              <button type="button" className="btn" onClick={onClose}>
                Закрыть
              </button>
            ) : phase === 'pass' ? (
              <button type="button" className="btn" onClick={collect}>
                Забрать +{task.points}
              </button>
            ) : (
              <button
                type="button"
                className="btn"
                disabled={!preview || phase === 'checking'}
                onClick={checkPhoto}
              >
                {phase === 'checking' ? 'Проверяем…' : 'Проверить фото'}
              </button>
            )}

            {!done && phase !== 'pass' && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                style={{ marginTop: 10 }}
                onClick={() => setManualOpen(true)}
              >
                🔑 Засчитать вручную
              </button>
            )}

            {isDev && !done && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                style={{ marginTop: 10 }}
                onClick={devComplete}
              >
                Завершить без фото (dev)
              </button>
            )}
          </div>
      </motion.div>

      {manualOpen && (
        <ManualApprovalSheet
          onClose={() => setManualOpen(false)}
          onSuccess={() => {
            setManualOpen(false);
            onManualComplete(task.id);
            onClose();
          }}
        />
      )}
    </motion.div>
  );
}
