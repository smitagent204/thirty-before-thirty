import type { CSSProperties } from 'react';
import { LEVEL_BY_ID } from '@shared/levels';
import type { Rarity, Task, TaskStatus } from '@shared/types';

interface TaskCardProps {
  task: Task;
  status: TaskStatus;
  onOpen: (task: Task) => void;
  onLocked: (task: Task) => void;
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  locked: 'Закрыто',
  available: 'Доступно',
  completed: 'Выполнено',
};

export const RARITY_VARS: Record<Rarity, { base: string; light: string; gradient: string }> = {
  common: { base: '--c-common', light: '--c-common-light', gradient: '--g-common' },
  rare: { base: '--c-rare', light: '--c-rare-light', gradient: '--g-rare' },
  epic: { base: '--c-epic', light: '--c-epic-light', gradient: '--g-epic' },
  legendary: { base: '--c-legend', light: '--c-legend-light', gradient: '--g-legend' },
};

export function TaskCard({ task, status, onOpen, onLocked }: TaskCardProps) {
  const level = LEVEL_BY_ID.get(task.level);
  const rarity = level?.rarity ?? 'common';
  const vars = RARITY_VARS[rarity];

  const style = {
    '--rarity': `var(${vars.base})`,
    '--rarity-light': `var(${vars.light})`,
  } as CSSProperties;

  const handleClick = () => {
    if (status === 'locked') onLocked(task);
    else onOpen(task);
  };

  return (
    <button
      type="button"
      className={`task-card is-${status}`}
      style={style}
      onClick={handleClick}
      aria-disabled={status === 'locked'}
      aria-label={`${task.title}. ${task.points} баллов. ${STATUS_LABEL[status]}`}
    >
      <span className="task-card__badge" aria-hidden="true">
        {String(task.order).padStart(2, '0')}
      </span>
      <span className="task-card__body">
        <span className="task-card__title">{task.title}</span>
        <span className="task-card__meta">
          <span className="points">
            +{task.points} {task.points === 1 ? 'балл' : task.points < 5 ? 'балла' : 'баллов'}
          </span>
          <span className="task-card__status">{STATUS_LABEL[status]}</span>
        </span>
      </span>
      <span className="task-card__state-icon" aria-hidden="true">
        {status === 'locked' ? '🔒' : status === 'completed' ? '✓' : '›'}
      </span>
    </button>
  );
}
