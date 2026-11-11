export type LevelId = 1 | 2 | 3 | 4;

export type TaskStatus = 'locked' | 'available' | 'completed';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

/**
 * Рубрика для AI. Оценка считается от 100 вниз:
 * - каждый обязательный пункт виден и однозначен → 100;
 * - за отсутствующий или нечитаемый пункт вычитается не больше его веса;
 * - pass при 70 и выше, fail ниже 70;
 * - скриншот или чужое фото — fail вне зависимости от пунктов.
 */
export interface TaskRequirement {
  /** Стабильный id: модель возвращает его в deductions, сервер берёт подпись отсюда */
  id: string;
  /** Что должно быть видно — формулировка для человека и для AI */
  label: string;
  /** Как назвать нехватку в списке минусов: «меньше трёх образцов» */
  miss: string;
  /** Максимальный штраф, если пункта нет или он не читается */
  weight: number;
}

export interface TaskRubric {
  /** Только эти пункты влияют на оценку */
  required: TaskRequirement[];
  /** Необязательные детали: только хвалим, никогда не штрафуем */
  optional: string[];
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

export interface AiDeduction {
  /** id обязательного пункта из рубрики задания */
  id?: string;
  label: string;
  percent: number;
}

export interface AiVerdict {
  score: number;
  verdict: 'pass' | 'fail';
  reason: string;
  confidence: number;
  /** Разбивка разницы до 100 %: чего не хватило и на сколько процентов. */
  deductions?: AiDeduction[];
}
