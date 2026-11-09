import { LEVEL_1_2_TASKS } from './tasks.level12';
import { LEVEL_3_4_TASKS } from './tasks.level34';
import type { Task } from './types';

export const TASKS: Task[] = [...LEVEL_1_2_TASKS, ...LEVEL_3_4_TASKS];

export const TASK_BY_ID = new Map(TASKS.map((task) => [task.id, task]));
