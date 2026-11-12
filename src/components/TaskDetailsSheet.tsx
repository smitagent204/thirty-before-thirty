import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { LEVEL_BY_ID } from '@shared/levels';
import { APPEAL_MAX_CHARS, type AiDeduction, type AiVerdict, type Task, type TaskStatus } from '@shared/types';
import { impact, notify } from '../telegram/useTelegram';
import { api, ApiError, hasTelegramAuth, type PhotoResult } from '../api/client';
import { compressPhoto } from '../lib/photo';
import { invalidatePhoto, loadPhoto } from '../api/photoCache';
import { ManualApprovalSheet } from './ManualApprovalSheet';
import { VerdictDetails } from './VerdictDetails';

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
  const [improving, setImproving] = useState(false);
  const [improveResult, setImproveResult] = useState<{
    score: number;
    reason: string;
    deductions: AiDeduction[];
    saved: boolean;
    previousScore: number | null;
  } | null>(null);
  const [appealOpen, setAppealOpen] = useState(false);
  const [appealText, setAppealText] = useState('');
  const [appealBusy, setAppealBusy] = useState(false);
  const [appealError, setAppealError] = useState<string | null>(null);
  const [appealDetailsOpen, setAppealDetailsOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const serverAuth = hasTelegramAuth();
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
  const [done, setDone] = useState(() => status === 'completed');

  // Если задание уже выполнено, показываем фото, которое прошло проверку.
  useEffect(() => {
    if (!done || !serverAuth) return;
    let cancelled = false;
    loadPhoto(task.id)
      .then((photo) => {
        if (!cancelled) setAcceptedPhoto(photo);
      })
      .catch(() => {
        // фото могло не сохраниться после ручного сброса — просто не показываем
      });
    return () => {
      cancelled = true;
    };
  }, [done, serverAuth, task.id]);

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
      const isRecheck = done || result.recheck === true;
      if (isRecheck && !done) setDone(true);
      setVerdict({
        score: result.score,
        verdict: result.verdict,
        reason: result.reason,
        confidence: result.confidence,
      });
      if (result.pass) {
        // Сервер мог сохранить новый кадр — старый из кэша больше не нужен.
        invalidatePhoto(task.id);
        setPhase('pass');
        notify('success');

        if (isRecheck) {
          const saved = result.saved !== false;
          if (saved) {
            setAcceptedPhoto({
              image,
              score: result.score,
              verdict: 'pass',
              reason: result.reason,
              deductions: result.deductions ?? [],
              confidence: result.confidence,
              createdAt: new Date().toISOString(),
            });
            // Подтягиваем серверную запись, чтобы дата и данные были точными.
            void loadPhoto(task.id)
              .then((photo) => setAcceptedPhoto(photo))
              .catch(() => {});
          }
          setImproveResult({
            score: result.score,
            reason: result.reason,
            deductions: result.deductions ?? [],
            saved,
            previousScore: result.previousScore ?? null,
          });
          setImproving(false);
          setFile(null);
          setPreview(null);
          setFileName(null);
        }

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

  const startAppeal = () => {
    setAppealOpen(true);
    setAppealError(null);
    impact('light');
  };

  const cancelAppeal = () => {
    setAppealOpen(false);
    setAppealError(null);
  };

  const submitAppeal = async () => {
    const text = appealText.trim();
    if (!text || appealBusy) return;
    setAppealBusy(true);
    setAppealError(null);
    impact('medium');

    try {
      const result = await api.appeal(task.id, text);
      // Оценка и минусы изменились — старое фото в кэше больше не актуально.
      invalidatePhoto(task.id);
      setAppealOpen(false);
      setAppealText('');
      setAcceptedPhoto((prev) =>
        prev
          ? {
              ...prev,
              score: result.score,
              verdict: result.verdict,
              // Похвала от пересмотра не меняется.
              reason: prev.reason ?? result.reason,
              deductions: result.deductions,
              appealedAt: result.appealedAt,
              appealScoreBefore: result.scoreBefore,
              appealText: result.appealText,
              appealDeductions: result.appealDeductions,
              appealReason: result.appealReason,
            }
          : prev,
      );
      notify('success');
      await onChecked();
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.code === 'appeal_already_used'
            ? 'Для этого фото апелляция уже использована.'
            : error.code === 'nothing_to_appeal'
              ? 'Снимать нечего: замечаний к фото нет.'
              : error.code === 'appeal_too_long'
                ? `Слишком длинное пояснение — максимум ${APPEAL_MAX_CHARS} символов.`
                : error.code === 'ai_unavailable'
                  ? 'Пересмотр временно недоступен. Попробуй позже — попытка не потрачена.'
                  : 'Не удалось пересмотреть оценку. Попробуй ещё раз.'
          : 'Не удалось отправить апелляцию. Проверь интернет и попробуй ещё раз.';
      setAppealError(message);
      notify('error');
    } finally {
      setAppealBusy(false);
    }
  };

  const startImprove = () => {
    setImproving(true);
    setImproveResult(null);
    setPhase('idle');
    setVerdict(null);
    setFile(null);
    setPreview(null);
    setFileName(null);
  };

  const collect = () => {
    onComplete(task.id);
    notify('success');
    onClose();
  };

  const cancelImprove = () => {
    setImproving(false);
    setPhase('idle');
    setVerdict(null);
    setFile(null);
    setPreview(null);
    setFileName(null);
  };

  const devComplete = async () => {
    await onDevComplete(task.id);
    onClose();
  };

  const improveDelta =
    improveResult && improveResult.previousScore !== null
      ? improveResult.score - improveResult.previousScore
      : null;

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

            {done && (
              <section className="sheet__section">
                <h4 className="sheet__section-title">
                  <span aria-hidden="true">✓</span> Задание выполнено
                </h4>
                <p className="sheet__hint">
                  {isManual
                    ? 'Задание засчитано вручную — фото не требовалось.'
                    : 'Фото проверено, баллы зачислены.'}
                </p>
                {acceptedPhoto && !improving && (
                  <div className="accepted-photo">
                    <img src={acceptedPhoto.image} alt="Принятое фото" />
                    <div className="accepted-photo__meta">
                      <span>Принятое фото</span>
                      <span className="accepted-photo__score">
                        {acceptedPhoto.score}%
                      </span>
                    </div>
                    <VerdictDetails
                      reason={acceptedPhoto.reason}
                      deductions={acceptedPhoto.deductions}
                      taskId={task.id}
                      compact
                    />

                    {acceptedPhoto.appealedAt ? (
                      <div className="appeal-note appeal-note--result">
                        <p className="appeal-note__summary">
                          Результат пересмотрен
                          {typeof acceptedPhoto.appealScoreBefore === 'number'
                            ? `: ${acceptedPhoto.appealScoreBefore}% → ${acceptedPhoto.score}%`
                            : ''}
                        </p>
                        <button
                          type="button"
                          className="appeal-note__toggle"
                          onClick={() => setAppealDetailsOpen((value) => !value)}
                          aria-expanded={appealDetailsOpen}
                        >
                          {appealDetailsOpen
                            ? 'Скрыть апелляцию'
                            : 'Посмотреть апелляцию'}
                        </button>
                        {appealDetailsOpen && (
                          <div className="appeal-details">
                            {(acceptedPhoto.appealDeductions?.length ?? 0) > 0 && (
                              <>
                                <p className="appeal-details__title">
                                  Замечания до апелляции
                                </p>
                                <VerdictDetails
                                  deductions={acceptedPhoto.appealDeductions}
                                  taskId={task.id}
                                  compact
                                />
                              </>
                            )}
                            {acceptedPhoto.appealText && (
                              <>
                                <p className="appeal-details__title">Ваше пояснение</p>
                                <p className="appeal-details__quote">
                                  «{acceptedPhoto.appealText}»
                                </p>
                              </>
                            )}
                            {acceptedPhoto.appealReason && (
                              <>
                                <p className="appeal-details__title">Ответ на апелляцию</p>
                                <p className="appeal-details__text">
                                  {acceptedPhoto.appealReason}
                                </p>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (acceptedPhoto.deductions?.length ?? 0) > 0 ? (
                      appealOpen ? (
                        <div className="appeal-form">
                          <label
                            className="appeal-form__label"
                            htmlFor={`appeal-${task.id}`}
                          >
                            Почему снижение несправедливо?
                          </label>
                          <textarea
                            id={`appeal-${task.id}`}
                            className="appeal-form__input"
                            value={appealText}
                            maxLength={APPEAL_MAX_CHARS}
                            rows={4}
                            placeholder="1–3 предложения: что именно видно на фото и почему замечание не подходит."
                            onChange={(event) => setAppealText(event.target.value)}
                            disabled={appealBusy}
                          />
                          <div className="appeal-form__foot">
                            <span className="appeal-form__counter">
                              {appealText.length} / {APPEAL_MAX_CHARS}
                            </span>
                            <div className="appeal-form__actions">
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                onClick={cancelAppeal}
                                disabled={appealBusy}
                              >
                                Отмена
                              </button>
                              <button
                                type="button"
                                className="btn btn--sm"
                                onClick={() => void submitAppeal()}
                                disabled={!appealText.trim() || appealBusy}
                              >
                                {appealBusy ? 'Пересматриваем…' : 'Отправить'}
                              </button>
                            </div>
                          </div>
                          <p className="appeal-form__hint">
                            Апелляция для одного фото — один раз. Оценка может только
                            вырасти. У каждого минуса выше можно раскрыть требование — опирайся
                            на него в пояснении.
                          </p>
                          {appealError && (
                            <p className="appeal-form__error">{appealError}</p>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={startAppeal}
                        >
                          ✍️ Оспорить снижение баллов
                        </button>
                      )
                    ) : null}
                  </div>
                )}
                {improveResult && (
                  <div
                    className={`improve-note${
                      improveResult.saved ? ' improve-note--saved' : ''
                    }`}
                  >
                    <p className="improve-note__summary">
                      {improveResult.saved
                        ? `Оценка обновлена: ${improveResult.score}%${
                            improveDelta !== null && improveDelta > 0
                              ? ` (+${improveDelta})`
                              : ''
                          }`
                        : 'Новое фото прошло порог, но оценка не выше прежней — оставили предыдущий кадр'}
                    </p>
                    <VerdictDetails
                      reason={improveResult.reason}
                      deductions={improveResult.deductions}
                      taskId={task.id}
                      compact
                    />
                  </div>
                )}
                {serverAuth && !improving && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    style={{ marginTop: 10 }}
                    onClick={startImprove}
                  >
                    Загрузить новое фото
                  </button>
                )}
              </section>
            )}

            {(!done || improving) && (
              <section className="sheet__section">
                <h4 className="sheet__section-title">
                  <span aria-hidden="true">📷</span>{' '}
                  {done ? 'Работа над ошибками' : 'Подтверждение'}
                </h4>
                {done && (
                  <p className="sheet__hint" style={{ marginBottom: 10 }}>
                    Загрузи новый кадр — если замечания исправлены, оценка станет выше, а
                    баллы останутся прежними.
                  </p>
                )}
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
                      <VerdictDetails
                        reason={verdict.reason}
                        deductions={verdict.deductions}
                        taskId={task.id}
                      />
                    </div>
                  </div>
                )}
              </section>
            )}

            <div className="sheet__meta">
              <span className="meta-chip">🏅 {task.points} баллов</span>
              <span className="meta-chip">🌿 Уровень {task.level}</span>
              {done && <span className="meta-chip meta-chip--done">✓ Выполнено</span>}
              {done && isManual && <span className="meta-chip">🔑 Засчитано вручную</span>}
            </div>
          </div>

          <div className="sheet__footer">
            {done && !improving ? (
              <button type="button" className="btn" onClick={onClose}>
                Закрыть
              </button>
            ) : !done && phase === 'pass' ? (
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
                {phase === 'checking'
                  ? 'Проверяем…'
                  : done
                    ? 'Проверить новое фото'
                    : 'Проверить фото'}
              </button>
            )}

            {done && improving && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                style={{ marginTop: 10 }}
                onClick={cancelImprove}
              >
                Отмена
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
