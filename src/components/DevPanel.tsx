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
  type WifePhotoInfo,
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
  const showHallIntro = useProgressStore((state) => state.showHallIntro);

  const serverMode = hasTelegramAuth();
  const [busy, setBusy] = useState(false);
  const [prizeNote, setPrizeNote] = useState<string | null>(null);
  const [prizePreview, setPrizePreview] = useState<string | null>(null);
  const [prizeLink, setPrizeLink] = useState<string | null>(null);
  const [wifeCompleted, setWifeCompleted] = useState<string[]>([]);
  const [wifeManual, setWifeManual] = useState<string[]>([]);
  const [wifeConfigured, setWifeConfigured] = useState<boolean | null>(null);
  const [wifeError, setWifeError] = useState<string | null>(null);
  const [wifePhotosError, setWifePhotosError] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [recheckRows, setRecheckRows] = useState<RecheckRow[]>([]);
  const [recheckTotal, setRecheckTotal] = useState(0);
  const [recheckOpen, setRecheckOpen] = useState(false);
  const [recheckSelected, setRecheckSelected] = useState<string[]>([]);
  const [wifePhotos, setWifePhotos] = useState<Record<string, WifePhotoInfo>>({});
  const [inspectTask, setInspectTask] = useState<Task | null>(null);
  const [inspectState, setInspectState] = useState<WifeTaskState | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [introOnExit, setIntroOnExit] = useState(false);
  const prizeInput = useRef<HTMLInputElement>(null);

  /** Чекбокс одноразовый: при закрытии панели показывает обучение и сам сбрасывается. */
  const closePanel = () => {
    if (introOnExit) {
      showHallIntro();
      setIntroOnExit(false);
    }
    onClose();
  };

  const loadWife = async () => {
    if (!serverMode) return;
    try {
      const state = await api.wife();
      setWifeError(null);
      setWifeCompleted(state.completed ?? []);
      setWifeManual(state.manualCompleted ?? []);
      setWifeConfigured(state.configured);
      setWifePhotosError(Boolean(state.photosError));
      setWifePhotos(
        Object.fromEntries((state.photos ?? []).map((photo) => [photo.taskId, photo])),
      );
    } catch (error) {
      setWifeError(error instanceof ApiError ? `${error.status} ${error.code}` : 'network');
      setWifeConfigured(false);
    }
  };

  useEffect(() => {
    void loadWife();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    } catch (error) {
      setInspectError(inspectErrorText(error));
    } finally {
      setInspectLoading(false);
    }
  };

  const recheckIds = wifeCompleted.filter((taskId) => !wifeManual.includes(taskId));
  // Если список оценок не пришёл, не прячем задания: переоценка опирается на
  // серверную запись, а не на этот список.
  const recheckableIds = wifePhotosError
    ? recheckIds
    : recheckIds.filter((taskId) => Boolean(wifePhotos[taskId]));

  /**
   * Если Workers AI отвечает `ai_unavailable`, повторяем запрос: без этого
   * у задания не появляется результат вовсе. Три попытки с паузами.
   */
  const recheckOne = async (taskId: string): Promise<RecheckResult> => {
    const delays = [900, 1800];
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await api.recheckWifeTask(taskId);
      } catch (error) {
        const retryable = error instanceof ApiError && error.code === 'ai_unavailable';
        if (!retryable || attempt >= delays.length) throw error;
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      }
    }
  };

  const recheckWife = async (ids: string[]) => {
    if (!serverMode || rechecking || ids.length === 0) return;
    setRecheckOpen(false);
    setRechecking(true);
    setRecheckTotal(ids.length);
    setRecheckRows([]);

    const rows: RecheckRow[] = [];
    for (const taskId of ids) {
      try {
        const result = await recheckOne(taskId);
        rows.push(result);
        // Держим список в модалке актуальным, если её откроют повторно.
        setWifePhotos((prev) => {
          const current = prev[taskId];
          if (!current) return prev;
          return {
            ...prev,
            [taskId]: {
              ...current,
              score: result.kept ? result.oldScore : result.newScore,
              verdict: result.verdict,
              appealedAt: result.appealReset ? null : current.appealedAt,
            },
          };
        });
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

  const openRecheck = () => {
    if (rechecking || recheckableIds.length === 0) return;
    setRecheckSelected(recheckableIds);
    setRecheckOpen(true);
  };

  const toggleRecheck = (taskId: string) => {
    setRecheckSelected((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId],
    );
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
    closePanel();
  };

  return (
    <div className="sheet-layer">
      <div className="scrim" onClick={closePanel} />
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
          <button type="button" className="sheet__close" onClick={closePanel} aria-label="Закрыть">
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
            <label className="dev-check">
              <input
                type="checkbox"
                checked={introOnExit}
                onChange={(event) => setIntroOnExit(event.target.checked)}
              />
              <span>
                Показать подсказку об аллее после закрытия панели
                <span className="dev-check__hint">
                  Сбросится автоматически, когда подсказка появится
                </span>
              </span>
            </label>
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
            {wifeConfigured === false ? (
              <>
                Не удалось получить прогресс жены
                {wifeError ? ` (${wifeError})` : ''}. Проверь, что в настройках Pages задан
                USER_TELEGRAM_ID и сервер задеплоен вместе с функциями.{' '}
                <button
                  type="button"
                  className="dev-inline-link"
                  onClick={() => void loadWife()}
                >
                  Повторить
                </button>
              </>
            ) : (
              'Розовый кружок — задание выполнено женой.'
            )}
          </p>

          {wifeConfigured === true && wifePhotosError && (
            <p className="dev-note">
              Оценки фото прочитать не удалось — в списке переоценки будут названия без баллов.
            </p>
          )}

          {wifeConfigured === true && recheckIds.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={rechecking || recheckableIds.length === 0}
                onClick={openRecheck}
              >
                {rechecking
                  ? `Переоцениваем… ${recheckRows.length} из ${recheckTotal}`
                  : `Переоценить фото жены (${recheckableIds.length})`}
              </button>
              <p className="dev-note">
                Запусти один раз после деплоя: сохранённые фото пересчитаются по новым правилам,
                ниже появится отчёт с минусами. Перед запуском можно выбрать задания. Если ИИ
                не отвечает, запрос повторяется — до трёх попыток.
              </p>

              {recheckRows.length > 0 && (
                <div className="dev-list" style={{ marginTop: 10 }}>
                  {recheckRows.map((row) => {
                    if ('error' in row) {
                      return (
                        <div className="dev-row" key={row.taskId}>
                          <div className="dev-row__main">
                            {row.title}
                            <span className="dev-row__sub">
                              Ошибка: {recheckErrorText(row.error)}
                            </span>
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
                          {row.appealReset && (
                            <span className="dev-row__sub">
                              Апелляция сброшена — можно подать заново
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
          <button type="button" className="btn" onClick={closePanel}>
            Готово
          </button>
        </div>
      </div>

      {recheckOpen && (
        <div className="sheet-layer sheet-layer--nested">
          <div className="scrim" onClick={() => setRecheckOpen(false)} />
          <div className="sheet sheet--compact">
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
                    переоценка
                  </span>
                </div>
                <h3 className="sheet__title">Какие фото переоценить?</h3>
              </div>
              <button
                type="button"
                className="sheet__close"
                onClick={() => setRecheckOpen(false)}
                aria-label="Закрыть"
              >
                ✕
              </button>
            </div>

            <div className="sheet__body">
              <div className="dev-list">
                {recheckIds.map((taskId) => {
                  const task = TASK_BY_ID.get(taskId);
                  const photo = wifePhotos[taskId];
                  const unknown = !photo && wifePhotosError;
                  const disabled = !photo && !unknown;
                  return (
                    <label
                      key={taskId}
                      className={`dev-check${disabled ? ' dev-check--disabled' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={recheckSelected.includes(taskId)}
                        disabled={disabled}
                        onChange={() => toggleRecheck(taskId)}
                      />
                      <span>
                        {task?.title ?? taskId}
                        <span className="dev-check__hint">
                          {task ? `${task.id} · +${task.points}` : taskId}
                          {photo
                            ? ` · сейчас ${photo.score}%${
                                photo.appealedAt ? ' · апелляция подана' : ''
                              }`
                            : unknown
                              ? ' · оценка недоступна, но переоценить можно'
                              : ' · фото не сохранено — переоценивать нечего'}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="dev-note">
                Отмеченные задания пересчитаются по актуальным правилам, остальные не тронем.
                Если ИИ не отвечает, запрос повторится сам — до трёх попыток.
              </p>
            </div>

            <div className="sheet__footer" style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setRecheckOpen(false)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn btn--sm"
                disabled={recheckSelected.length === 0}
                onClick={() => void recheckWife(recheckSelected)}
              >
                {`Переоценить выбранные (${recheckSelected.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

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
                        taskId={inspectTask.id}
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

function inspectErrorText(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Не удалось загрузить данные задания (сеть).';
  switch (error.code) {
    case 'wife_not_configured':
      return 'На сервере не задан USER_TELEGRAM_ID — данные жены недоступны.';
    case 'db_unavailable':
      return 'База данных не ответила. Попробуй ещё раз чуть позже.';
    case 'unauthorized':
    case 'init_data_expired':
      return 'Сессия Telegram истекла — закрой и снова открой приложение.';
    case 'forbidden':
      return 'Сервер не считает тебя владельцем — проверь OWNER_TELEGRAM_ID.';
    case 'server_not_configured':
      return 'На сервере не задан TELEGRAM_BOT_TOKEN.';
    default:
      return `Не удалось загрузить данные задания (${error.status} ${error.code}).`;
  }
}

function recheckErrorText(code: string): string {
  if (code === 'ai_unavailable') return 'ИИ не ответил, три попытки не удались';
  if (code === 'photo_not_found') return 'фото не сохранено';
  if (code === 'task_not_completed') return 'задание больше не отмечено выполненным';
  if (code === 'wife_not_configured') return 'не задан USER_TELEGRAM_ID';
  return code;
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
