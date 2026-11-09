import type { CSSProperties } from 'react';
import { LEVELS } from '@shared/levels';
import { nextAvailableTask, tasksOfLevel } from '@shared/progress';
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

  const completeNext = () => {
    const next = nextAvailableTask(completed);
    if (next) markCompleted(next.id);
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
            <button type="button" className="btn btn--ghost btn--sm" onClick={completeNext}>
              Завершить следующую доступную
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={completeAll}>
              Отметить все 30 (открыть сундук)
            </button>
            <button
              type="button"
              className={`btn btn--sm ${forceFail ? '' : 'btn--ghost'}`}
              onClick={() => setForceFail(!forceFail)}
            >
              Следующая проверка: {forceFail ? 'провал' : 'успех'}
            </button>
            <button type="button" className="btn btn--danger btn--sm" onClick={reset}>
              Сбросить прогресс
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={exitDev}>
              Выйти из режима разработчика
            </button>
          </div>

          <p className="dev-note">
            В продакшене панель открывается только для Telegram ID владельца и не видна
            обычному пользователю. Здесь она доступна всегда, чтобы проверять анимации и
            переходы без фото.
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
                        onClick={() => toggleCompleted(task.id)}
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
