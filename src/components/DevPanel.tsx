import { useRef, useState, type CSSProperties } from 'react';
import { LEVELS } from '@shared/levels';
import { nextAvailableTask, tasksOfLevel } from '@shared/progress';
import { api, hasTelegramAuth } from '../api/client';
import { readFileAsDataUrl } from '../lib/photo';
import { useProgressStore } from '../store/useProgressStore';

interface DevPanelProps {
  onClose: () => void;
}

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
  const prizeInput = useRef<HTMLInputElement>(null);

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
      setPrizeNote('QR-приз сохранён. Победитель увидит его после открытия сундука.');
    } catch {
      setPrizeNote('Не удалось загрузить QR. Проверь формат PNG/JPEG/WebP и размер.');
    } finally {
      setBusy(false);
      if (prizeInput.current) prizeInput.current.value = '';
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
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={busy}
                onClick={() => prizeInput.current?.click()}
              >
                Загрузить QR-приз
              </button>
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

          <p className="dev-note">
            Панель доступна только Telegram ID владельца. QR-приз хранится в защищённой базе
            и выдаётся победителю только после открытия сундука.
          </p>

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
                      <div className="dev-row__main">
                        {task.title}
                        <div className="dev-row__sub">
                          {task.id} · +{task.points}
                        </div>
                      </div>
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
    </div>
  );
}
