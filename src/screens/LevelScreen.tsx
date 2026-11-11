import { useEffect, type CSSProperties } from 'react';
import type { LevelMeta, Task, TaskStatus } from '@shared/types';
import { levelMaxPoints, computeLevelPoints, tasksOfLevel } from '@shared/progress';
import { ProgressRoadmap } from '../components/ProgressRoadmap';
import { TaskCard, RARITY_VARS } from '../components/TaskCard';
import { OrnamentDivider } from '../components/OrnamentDivider';

interface LevelScreenProps {
  level: LevelMeta;
  completed: string[];
  statuses: Map<string, TaskStatus>;
  /** Задание, к которому нужно прокрутить и подсветить после аллеи славы. */
  focusTaskId?: string | null;
  onFocusHandled?: () => void;
  onOpenTask: (task: Task) => void;
  onLocked: (task: Task) => void;
}

export function LevelScreen({
  level,
  completed,
  statuses,
  focusTaskId,
  onFocusHandled,
  onOpenTask,
  onLocked,
}: LevelScreenProps) {
  const tasks = tasksOfLevel(level.id);
  const max = levelMaxPoints(level.id);
  const points = computeLevelPoints(level.id, completed);
  const ready = points >= max;
  const vars = RARITY_VARS[level.rarity];

  useEffect(() => {
    if (!focusTaskId) return;
    const node = document.getElementById(`task-${focusTaskId}`);
    const frame = node
      ? window.requestAnimationFrame(() => {
          node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        })
      : null;
    // Подсветка живёт 2,6 с — этого хватает, чтобы понять, куда привела карточка.
    const timer = window.setTimeout(() => onFocusHandled?.(), 2600);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [focusTaskId, level.id, onFocusHandled]);

  const style = {
    '--level-gradient': `var(${vars.gradient})`,
    '--rarity': `var(${vars.base})`,
    '--rarity-light': `var(${vars.light})`,
  } as CSSProperties;

  return (
    <div className="screen">
      <section className="level-hero" style={style}>
        <div className="level-hero__inner">
          <div className="level-hero__top">
            <span className="rarity">
              <span aria-hidden="true">{level.emoji}</span>
              {level.rarityLabel}
            </span>
            <span className="level-hero__points">
              {points} / {max}
            </span>
          </div>
          <h2 className="level-hero__title">{level.name}</h2>
          <p className="level-hero__subtitle">{level.subtitle}</p>
        </div>
      </section>

      <ProgressRoadmap value={points} max={max} ready={ready} />

      <div className="task-list">
        {tasks.map((task, index) => {
          const chapter = level.chapters?.find((item) => item.afterOrder === task.order - 1);
          return (
            <div key={task.id}>
              {chapter ? (
                <OrnamentDivider label={chapter.title} />
              ) : (
                index > 0 && <OrnamentDivider />
              )}
              <TaskCard
                task={task}
                status={statuses.get(task.id) ?? 'locked'}
                highlighted={focusTaskId === task.id}
                onOpen={onOpenTask}
                onLocked={onLocked}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
