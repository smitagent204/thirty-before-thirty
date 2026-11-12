import { LEVEL_1_2_TASKS } from './tasks.level12';
import { LEVEL_3_4_TASKS } from './tasks.level34';
import type { Task } from './types';

// Порядок в массиве — это и порядок в аллее: держим его синхронным с order,
// даже если задания в файле описаны иначе.
export const TASKS: Task[] = [...LEVEL_1_2_TASKS, ...LEVEL_3_4_TASKS].sort(
  (a, b) => a.level - b.level || a.order - b.order,
);

export const TASK_BY_ID = new Map(TASKS.map((task) => [task.id, task]));
