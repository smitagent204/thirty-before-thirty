import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { LEVEL_BY_ID } from '@shared/levels';
import type { AiVerdict, Task, TaskStatus } from '@shared/types';
import { impact, notify } from '../telegram/useTelegram';
import { api, ApiError, hasTelegramAuth, type PhotoResult } from '../api/client';
import { compressPhoto } from '../lib/photo';
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
  /** Подтянуть состояние с сервера после успешной проверки. */
  onChecked: () => Promise<void>;
  onDevComplete: (taskId: string) => Promise<void>;
  onManualComplete: (taskId: string, pin: string) => Promise<boolean>;
}

export function TaskDetailsSheet({
  task,
  status,
  isDev,
  isManual,
  forceFail,
  onClose,
  onComplete,
  onChecked,
  onDevComplete,
  onManualComplete,
}: TaskDetailsSheetProps) {
  const level = LEVEL_BY_ID.get(task.level);
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<AiVerdict | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [acceptedPhoto, setAcceptedPhoto] = useState<PhotoResult | null>(null);
  const timer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const confetti = useMemo(
    () =>
      Array.from({ length: 16 }, (_, index) => {
        const angle = (Math.PI * 2 * index) / 16 + Math.random() * 0.4;
        const distance = 48 + Math.random() * 82;
        return {
          id: index,
          x: 50 + Math.cos(angle) * 12,
          y: 48 + Math.sin(angle) * 9,
          dx: Math.cos(angle) * distance,
          dy: Math.sin(angle) * distance - 22,
          delay: Math.round(Math.random() * 110),
          duration: 780 + Math.round(Math.random() * 360),
          size: 4 + Math.random() * 4,
          color: ['#ffd75e', '#ffe9a8', '#63d471', '#b9f3c1', '#ffffff'][index % 5],
          spin: 180 + Math.round(Math.random() * 360),
        };
      }),
    [],
  );
  // Фиксируем на момент открытия: если сервер подтвердит задание, пока лист открыт,
  // не переключаем интерфейс под руками — пользователь сам нажмёт «Забрать».
  const [done] = useState(() => status === 'completed');

  // Если задание уже выполнено, показываем фото, которое прошло проверку.
  useEffect(() => {
    if (!done || isManual || !hasTelegramAuth()) return;
    let cancelled = false;
    api
      .photo(task.id)
      .then((photo) => {
        if (!cancelled) setAcceptedPhoto(photo);
      })
      .catch(() => {
        // фото могло не сохраниться после ручного сброса — просто не показываем
      });
    return () => {
      cancelled = true;
    };
  }, [done, isManual, task.id]);

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

  const pickFile = (next: File | null) => {
    if (!next) return;
    if (preview) URL.revokeObjectURL(preview);
    setFile(next);
    setPreview(URL.createObjectURL(next));
    setFileName(next.name);
    setPhase('idle');
    setVerdict(null);
  };

  const checkPhoto = async () => {
    if (!file || phase === 'checking') return;
    impact('medium');
    setPhase('checking');
    setVerdict(null);

    // Вне Telegram — локальная имитация, чтобы можно было смотреть анимации.
    if (!hasTelegramAuth()) {
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
      return;
    }

    try {
      const image = await compressPhoto(file);
      const result = await api.check(task.id, image, isDev && forceFail);
      setVerdict({
        score: result.score,
        verdict: result.verdict,
        reason: result.reason,
        confidence: result.confidence,
      });
      if (result.pass) {
        setPhase('pass');
        notify('success');
        void onChecked();
      } else {
        setPhase('fail');
        notify('error');
      }
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.code === 'already_completed'
            ? 'Это задание уже выполнено.'
            : error.code === 'task_locked'
              ? 'Сначала выполни предыдущее задание.'
              : error.code === 'image_too_large' || error.code === 'photo_too_large'
                ? 'Фото слишком большое. Попробуй другой кадр.'
                : error.code === 'ai_unavailable'
                  ? 'Проверка фото временно недоступна. Попробуй позже.'
                  : 'Не удалось проверить фото. Попробуй ещё раз.'
          : 'Не удалось проверить фото. Проверь интернет и попробуй ещё раз.';
      setPhase('idle');
      setVerdict({ score: 0, verdict: 'fail', reason: message, confidence: 0 });
      notify('error');
    }
  };

  const collect = () => {
    onComplete(task.id);
    notify('success');
    onClose();
  };

  const devComplete = async () => {
    await onDevComplete(task.id);
    onClose();
  };

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
                {!isManual && acceptedPhoto && (
                  <div className="accepted-photo">
                    <img src={acceptedPhoto.image} alt="Принятое фото" />
                    <div className="accepted-photo__meta">
                      <span>Принятое фото</span>
                      <span className="accepted-photo__score">
                        {acceptedPhoto.score}%
                      </span>
                    </div>
                  </div>
                )}
              </section>
            ) : (
              <>
                <section className="sheet__section">
                  <h4 className="sheet__section-title">
                    <span aria-hidden="true">📷</span> Подтверждение
                  </h4>
                  <div
                    className={`dropzone${phase === 'checking' ? ' is-checking' : ''}${
                      phase === 'pass' ? ' is-accepted' : ''
                    }`}
                  >
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
                    {phase === 'pass' && (
                      <div className="accept-fx" aria-hidden="true">
                        <div className="accept-fx__confetti">
                          {confetti.map((piece) => (
                            <span
                              key={piece.id}
                              className="confetti-piece"
                              style={
                                {
                                  '--x': `${piece.x}%`,
                                  '--y': `${piece.y}%`,
                                  '--dx': `${piece.dx}px`,
                                  '--dy': `${piece.dy}px`,
                                  '--delay': `${piece.delay}ms`,
                                  '--dur': `${piece.duration}ms`,
                                  '--size': `${piece.size}px`,
                                  '--color': piece.color,
                                  '--spin': `${piece.spin}deg`,
                                } as CSSProperties
                              }
                            />
                          ))}
                        </div>
                        <span className="accept-fx__stamp">✓ Фото принято</span>
                      </div>
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
                      <div className="verdict__body">
                        {verdict.verdict === 'pass' && (
                          <strong className="verdict__title">Фото принято</strong>
                        )}
                        <span>{verdict.reason}</span>
                      </div>
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
                disabled={!file || phase === 'checking'}
                onClick={() => void checkPhoto()}
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
                onClick={() => void devComplete()}
              >
                Завершить без фото (dev)
              </button>
            )}
          </div>
      </motion.div>

      {manualOpen && (
        <ManualApprovalSheet
          onClose={() => setManualOpen(false)}
          onSubmit={(pin) => onManualComplete(task.id, pin)}
          onSuccess={() => {
            setManualOpen(false);
            onClose();
          }}
        />
      )}
    </motion.div>
  );
}
