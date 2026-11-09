import { LEVELS, TOTAL_POINTS, openSlotsForLevel } from './levels';
import { TASKS, TASK_BY_ID } from './tasks';
import type { LevelId, Task, TaskStatus } from './types';

export function tasksOfLevel(level: LevelId): Task[] {
  return TASKS.filter((task) => task.level === level).sort((a, b) => a.order - b.order);
}

export function levelMaxPoints(level: LevelId): number {
  return tasksOfLevel(level).reduce((sum, task) => sum + task.points, 0);
}

/**
 * Статусы задач вычисляются из списка выполненных.
 * Уровень 2 держит открытыми три задачи одновременно, остальные — одну.
 */
export function computeStatuses(completedIds: Iterable<string>): Map<string, TaskStatus> {
  const done = new Set(completedIds);
  const statuses = new Map<string, TaskStatus>();

  for (const level of LEVELS) {
    const slots = openSlotsForLevel(level.id);
    let availableLeft = slots;

    for (const task of tasksOfLevel(level.id)) {
      if (done.has(task.id)) {
        statuses.set(task.id, 'completed');
        continue;
      }
      if (availableLeft > 0) {
        statuses.set(task.id, 'available');
        availableLeft -= 1;
      } else {
        statuses.set(task.id, 'locked');
      }
    }
  }

  return statuses;
}

export function computePoints(completedIds: Iterable<string>): number {
  let points = 0;
  for (const id of completedIds) {
    const task = TASK_BY_ID.get(id);
    if (task) points += task.points;
  }
  return points;
}

export function computeLevelPoints(level: LevelId, completedIds: Iterable<string>): number {
  const done = new Set(completedIds);
  return tasksOfLevel(level)
    .filter((task) => done.has(task.id))
    .reduce((sum, task) => sum + task.points, 0);
}

export function isChestReady(completedIds: Iterable<string>): boolean {
  return computePoints(completedIds) >= TOTAL_POINTS;
}

export function nextAvailableTask(completedIds: Iterable<string>): Task | null {
  const statuses = computeStatuses(completedIds);
  for (const task of TASKS) {
    if (statuses.get(task.id) === 'available') return task;
  }
  return null;
}

export function progressPercent(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}
