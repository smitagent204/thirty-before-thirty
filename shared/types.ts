export type LevelId = 1 | 2 | 3 | 4;

export type TaskStatus = 'locked' | 'available' | 'completed';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

/**
 * Рубрика для AI. Оценка устроена так:
 * - база выполнена → 72–79 (проходной балл);
 * - база + «хорошо» → 80–89;
 * - база + «хорошо» + «бонус» → 90–100;
 * - часть базы отсутствует → 45–69;
 * - не по теме / скриншот / чужое фото → ≤20.
 */
export interface TaskRubric {
  /** Обязательная основа: без неё задание не выполнено */
  base: string[];
  /** Уверенное выполнение: заметно повышает оценку */
  good: string[];
  /** Детали, которые выводят на 90–100 */
  bonus: string[];
  /** Что снижает оценку */
  penalties: string[];
}

export interface Task {
  id: string;
  level: LevelId;
  order: number;
  points: number;
  title: string;
  description: string;
  /** Что человеку нужно снять — показывается в форме подтверждения */
  photoHint: string;
  /** Градация требований для AI-проверки */
  rubric: TaskRubric;
  emoji: string;
}

export interface Chapter {
  /** После задачи с каким order заканчивается глава */
  afterOrder: number;
  title: string;
}

export interface LevelMeta {
  id: LevelId;
  name: string;
  subtitle: string;
  rarity: Rarity;
  rarityLabel: string;
  emoji: string;
  tabLabel: string;
  chapters?: Chapter[];
}

export interface TaskProgress {
  taskId: string;
  status: TaskStatus;
  completedAt?: string;
  attempts: number;
  lastScore?: number;
}

export interface AiVerdict {
  score: number;
  verdict: 'pass' | 'fail';
  reason: string;
  confidence: number;
}
