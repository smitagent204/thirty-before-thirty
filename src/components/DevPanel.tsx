import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { LEVELS } from '@shared/levels';
import { nextAvailableTask, tasksOfLevel } from '@shared/progress';
import { TASK_BY_ID } from '@shared/tasks';
import type { AiDeduction, Task } from '@shared/types';
import {
  api,
  ApiError,
  hasTelegramAuth,
  type RecheckResult,
  type WifeTaskState,
} from '../api/client';
import { readFileAsDataUrl } from '../lib/photo';
import { decodeQrLink } from '../lib/qr';
import { useProgressStore } from '../store/useProgressStore';
import { impact, openExternalLink } from '../telegram/useTelegram';
import { VerdictDetails } from './VerdictDetails';

interface DevPanelProps {
  onClose: () => void;
}

type RecheckRow =
  | RecheckResult
  | { taskId: string; title: string; error: string };

export function DevPanel({ onClose }: DevPanelProps) {
  const completed = useProgressStore((state) => state.completed);
  const forceFail = useProgressStore((state) => state.forceFail);
  const markCompleted = useProgressStore((state) => state.markCompleted);
  const toggleCompleted = useProgressStore((state) => state.toggleCompleted);
  const completeAll = useProgressStore((state) => state.completeAll);
  const reset = useProgressStore((state) => state.reset);
  const setForceFail = useProgressStore((state) => state.setForceFail);
  const setDevMode = useProgressStore((state) => state.setDevMode);
  const hydrate = useProgressStore((state) => state.hydrate);

  const serverMode = hasTelegramAuth();
  const [busy, setBusy] = useState(false);
  const [prizeNote, setPrizeNote] = useState<string | null>(null);
  const [prizePreview, setPrizePreview] = useState<string | null>(null);
  const [prizeLink, setPrizeLink] = useState<string | null>(null);
  const [wifeCompleted, setWifeCompleted] = useState<string[]>([]);
  const [wifeManual, setWifeManual] = useState<string[]>([]);
  const [wifeConfigured, setWifeConfigured] = useState<boolean | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const [recheckRows, setRecheckRows] = useState<RecheckRow[]>([]);
  const [inspectTask, setInspectTask] = useState<Task | null>(null);
  const [inspectState, setInspectState] = useState<WifeTaskState | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const prizeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!serverMode) return;
    let cancelled = false;
    api
      .wife()
      .then((state) => {
        if (cancelled) return;
        setWifeCompleted(state.completed);
        setWifeManual(state.manualCompleted);
        setWifeConfigured(state.configured);
      })
      .catch(() => {
        if (!cancelled) setWifeConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serverMode]);

  const runServer = async (action: string, body?: unknown): Promise<boolean> => {
    setBusy(true);
    setPrizeNote(null);
    try {
      const state = await api.dev(action, body);
      hydrate(state);
      return true;
    } catch {
      setPrizeNote('Не удалось выполнить действие на сервере.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const completeNext = async () => {
    if (serverMode) {
      await runServer('complete-next');
      return;
    }
    const next = nextAvailableTask(completed);
    if (next) markCompleted(next.id);
  };

  const completeAllTasks = async () => {
    if (serverMode) {
      await runServer('complete-all');
      return;
    }
    completeAll();
  };

  const resetProgress = async () => {
    if (serverMode) {
      await runServer('reset');
      return;
    }
    reset();
  };

  const toggleTask = async (taskId: string) => {
    if (serverMode) {
      await runServer('toggle', { taskId });
      return;
    }
    toggleCompleted(taskId);
  };

  const uploadPrize = async (file: File | null) => {
    if (!file) return;
    if (file.size > 1_100_000) {
      setPrizeNote('Файл слишком большой: максимум ~1 МБ.');
      return;
    }
    setBusy(true);
    setPrizeNote(null);
    try {
      const image = await readFileAsDataUrl(file);
      await api.dev('prize', { image });
      // Читаем обратно с сервера: так видно не только выбор файла, но и то,
      // что QR действительно сохранился в D1.
      const saved = await api.prize();
      setPrizePreview(saved.image);
      void decodeQrLink(saved.image)
        .then((value) => setPrizeLink(value))
        .catch(() => setPrizeLink(null));
      // Если экран приза уже открыт, он перезапросит картинку без перезагрузки.
      window.dispatchEvent(new Event('prize-updated'));
      setPrizeNote('QR-приз сохранён в базе. Победитель увидит его после открытия сундука.');
    } catch {
      setPrizeNote('Не удалось загрузить QR. Проверь формат PNG/JPEG/WebP и размер.');
    } finally {
      setBusy(false);
      if (prizeInput.current) prizeInput.current.value = '';
    }
  };

  const checkPrize = async () => {
    if (!serverMode) return;
    setBusy(true);
    setPrizeNote(null);
    try {
      const saved = await api.prize();
      setPrizePreview(saved.image);
      void decodeQrLink(saved.image)
        .then((value) => setPrizeLink(value))
        .catch(() => setPrizeLink(null));
      setPrizeNote('QR-приз найден в базе.');
    } catch (error) {
      setPrizePreview(null);
      setPrizeLink(null);
      setPrizeNote(
        error instanceof ApiError && error.code === 'prize_not_found'
          ? 'В базе пока нет QR-приза.'
          : 'Не удалось получить QR-приз с сервера.',
      );
    } finally {
      setBusy(false);
    }
  };

  const openWifeTask = async (task: Task) => {
    if (!serverMode) return;
    setInspectTask(task);
    setInspectState(null);
    setInspectError(null);
    setInspectLoading(true);
    try {
      setInspectState(await api.wifeTask(task.id));
    } catch {
      setInspectError('Не удалось загрузить данные задания.');
    } finally {
      setInspectLoading(false);
    }
  };

  const recheckIds = wifeCompleted.filter((taskId) => !wifeManual.includes(taskId));

  const recheckWife = async () => {
    if (!serverMode || rechecking || recheckIds.length === 0) return;
    setRechecking(true);
    setRecheckRows([]);

    const rows: RecheckRow[] = [];
    for (const taskId of recheckIds) {
      try {
        rows.push(await api.recheckWifeTask(taskId));
      } catch (error) {
        rows.push({
          taskId,
          title: TASK_BY_ID.get(taskId)?.title ?? taskId,
          error: error instanceof ApiError ? error.code : 'failed',
        });
      }
      setRecheckRows([...rows]);
    }

    setRechecking(false);
  };

  const dismissDeduction = async (taskId: string, item: AiDeduction) => {
    if (!serverMode) return;
    try {
      const result = await api.dismissWifeDeduction(taskId, item.id ?? item.label);
      setInspectState((prev) =>
        prev?.photo
          ? {
              ...prev,
              photo: {
                ...prev.photo,
                score: result.score,
                verdict: result.verdict,
                reason: result.reason,
                deductions: result.deductions,
              },
            }
          : prev,
      );
    } catch {
      // Если не удалось — оставляем как было, без лишнего шума.
    }
  };

  const exitDev = () => {
    setForceFail(false);
    setDevMode(false);
    onClose();
  };

  return (
    <div className="sheet-layer">
      <div className="scrim" onClick={onClose} />
      <div className="sheet" style={{ maxHeight: '92%' }}>
        <div className="sheet__handle" />
        <div className="sheet__head">
          <div className="sheet__head-text">
            <div className="sheet__eyebrow">
              <span
                className="rarity"
                style={
                  { '--rarity': 'var(--c-info)', '--rarity-light': 'var(--c-info)' } as CSSProperties
                }
              >
                developer
              </span>
            </div>
            <h3 className="sheet__title">Панель разработчика</h3>
          </div>
          <button type="button" className="sheet__close" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>

        <div className="sheet__body">
          <div className="dev-list">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={busy}
              onClick={() => void completeNext()}
            >
              Завершить следующую доступную
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={busy}
              onClick={() => void completeAllTasks()}
            >
              Отметить все 30 (открыть сундук)
            </button>
            <button
              type="button"
              className={`btn btn--sm ${forceFail ? '' : 'btn--ghost'}`}
              onClick={() => setForceFail(!forceFail)}
            >
              Следующая проверка: {forceFail ? 'провал' : 'успех'}
            </button>
            <button
              type="button"
              className="btn btn--danger btn--sm"
              disabled={busy}
              onClick={() => void resetProgress()}
            >
              Сбросить прогресс
            </button>
            {serverMode && (
              <>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={busy}
                  onClick={() => prizeInput.current?.click()}
                >
                  Загрузить QR-приз
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={busy}
                  onClick={() => void checkPrize()}
                >
                  Показать QR-приз
                </button>
              </>
            )}
            <input
              ref={prizeInput}
              style={{ display: 'none' }}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => void uploadPrize(event.target.files?.[0] ?? null)}
              aria-label="Загрузить QR-приз"
            />
            <button type="button" className="btn btn--ghost btn--sm" onClick={exitDev}>
              Выйти из режима разработчика
            </button>
          </div>

          {prizeNote && <p className="dev-note">{prizeNote}</p>}

          {prizePreview && (
            <div className="dev-prize">
              <img src={prizePreview} alt="Загруженный QR-приз" />
            </div>
          )}

          {prizeLink && (
            <button
              type="button"
              className="btn btn--sm"
              style={{ marginTop: 10 }}
              onClick={() => {
                impact('medium');
                openExternalLink(prizeLink);
              }}
            >
              Проверить переход по QR
            </button>
          )}

          <p className="dev-note">
            Панель доступна только Telegram ID владельца. QR-приз хранится в защищённой базе:
            победитель видит его после открытия сундука, а владелец может проверить заранее.
          </p>

          <p className="dev-note">
            {wifeConfigured === false
              ? 'USER_TELEGRAM_ID не задан — прогресс второго пользователя недоступен.'
              : 'Розовый кружок — задание выполнено женой.'}
          </p>

          {wifeConfigured === true && recheckIds.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={rechecking}
                onClick={() => void recheckWife()}
              >
                {rechecking
                  ? 'Переоцениваем…'
                  : `Переоценить фото жены (${recheckIds.length})`}
              </button>
              <p className="dev-note">
                Запусти один раз после деплоя: сохранённые фото пересчитаются по новым правилам,
                ниже появится отчёт с минусами.
              </p>

              {recheckRows.length > 0 && (
                <div className="dev-list" style={{ marginTop: 10 }}>
                  {recheckRows.map((row) => {
                    if ('error' in row) {
                      return (
                        <div className="dev-row" key={row.taskId}>
                          <div className="dev-row__main">
                            {row.title}
                            <span className="dev-row__sub">Ошибка: {row.error}</span>
                          </div>
                        </div>
                      );
                    }

                    const misses = row.kept
                      ? row.candidateDeductions ?? []
                      : row.deductions;

                    return (
                      <div className="dev-row" key={row.taskId}>
                        <div className="dev-row__main">
                          {row.title}
                          <span className="dev-row__sub">
                            {`${row.oldScore}% → ${row.newScore}%${
                              row.improved ? ' ↑' : row.newScore < row.oldScore ? ' ↓' : ''
                            }`}
                            {row.kept ? ' · оставили прежнюю оценку' : ` · ${row.reason}`}
                          </span>
                          {misses.length > 0 && (
                            <span className="dev-row__sub dev-row__sub--misses">
                              {row.kept ? 'Новая проверка предлагала: ' : ''}
                              {misses
                                .map((item) => `−${item.percent}% — ${item.label}`)
                                .join('; ')}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {LEVELS.map((level) => (
            <div key={level.id}>
              <h4 className="sheet__section-title" style={{ marginTop: 16 }}>
                {level.emoji} Уровень {level.id} · {level.name}
              </h4>
              <div className="dev-list">
                {tasksOfLevel(level.id).map((task) => {
                  const isDone = completed.includes(task.id);
                  return (
                    <div className="dev-row" key={task.id}>
                      <button
                        type="button"
                        className="dev-row__main dev-row__main--clickable"
                        onClick={() => void openWifeTask(task)}
                      >
                        {wifeCompleted.includes(task.id) && (
                          <span
                            className="dev-row__wife-dot"
                            title="Выполнено женой"
                            aria-label="Выполнено женой"
                          />
                        )}
                        {task.title}
                        <span className="dev-row__sub">
                          {task.id} · +{task.points}
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`dev-row__check${isDone ? ' is-done' : ''}`}
                        disabled={busy}
                        onClick={() => void toggleTask(task.id)}
                        aria-label={isDone ? 'Снять отметку' : 'Отметить выполненной'}
                      >
                        {isDone ? '✓' : '+'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="sheet__footer">
          <button type="button" className="btn" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>

      {inspectTask && (
        <div className="sheet-layer sheet-layer--nested">
          <div className="scrim" onClick={() => setInspectTask(null)} />
          <div className="sheet sheet--compact">
            <div className="sheet__handle" />
            <div className="sheet__head">
              <div className="sheet__head-text">
                <div className="sheet__eyebrow">
                  <span
                    className="rarity"
                    style={
                      {
                        '--rarity': '#ff8fc7',
                        '--rarity-light': '#ffd0e6',
                      } as CSSProperties
                    }
                  >
                    прогресс жены
                  </span>
                </div>
                <h3 className="sheet__title">{inspectTask.title}</h3>
              </div>
              <button
                type="button"
                className="sheet__close"
                onClick={() => setInspectTask(null)}
                aria-label="Закрыть"
              >
                ✕
              </button>
            </div>

            <div className="sheet__body">
              {inspectLoading && <p className="sheet__hint">Загружаем…</p>}
              {inspectError && <p className="sheet__hint">{inspectError}</p>}

              {!inspectLoading && !inspectError && inspectState && !inspectState.completed && (
                <p className="sheet__hint">Жена ещё не выполняла это задание.</p>
              )}

              {!inspectLoading && inspectState?.completed && (
                <>
                  <p className="sheet__hint">
                    {inspectState.manual
                      ? 'Засчитано вручную, фото нет.'
                      : inspectState.photo
                        ? `Проверено ИИ: ${inspectState.photo.score}%.`
                        : 'Задание выполнено, но фото не сохранилось.'}
                    {inspectState.createdAt && (
                      <>
                        {' '}
                        Дата выполнения: {formatDateTime(inspectState.createdAt)}.
                      </>
                    )}
                  </p>

                  {inspectState.photo && (
                    <div style={{ marginTop: 10 }}>
                      <VerdictDetails
                        reason={inspectState.photo.reason}
                        deductions={inspectState.photo.deductions}
                        compact
                        onDismiss={(item) => void dismissDeduction(inspectTask.id, item)}
                      />
                      {inspectState.photo.appealedAt && (
                        <p className="dev-note" style={{ marginTop: 8 }}>
                          Апелляция рассмотрена
                          {typeof inspectState.photo.appealScoreBefore === 'number'
                            ? ` · было ${inspectState.photo.appealScoreBefore}%`
                            : ''}
                          .
                        </p>
                      )}
                      {(inspectState.photo.deductions?.length ?? 0) > 0 && (
                        <p className="dev-note" style={{ marginTop: 8 }}>
                          Если ИИ ошибся, нажми × у минуса — оценка пересчитается.
                        </p>
                      )}
                    </div>
                  )}

                  {inspectState.photo?.image && (
                    <div className="accepted-photo">
                      <img src={inspectState.photo.image} alt="Фото выполненного задания" />
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="sheet__footer">
              <button type="button" className="btn" onClick={() => setInspectTask(null)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDateTime(value: string): string {
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
