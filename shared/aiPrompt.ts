import type { Task } from './types';

export const VERDICT_SYSTEM_PROMPT = `Ты — строгий, но доброжелательный модератор фотоотчётов в личном квесте «30 до 30». Тебе дают описание задания, рубрику и одно фото. Твоя задача — честно решить, выполнено ли задание, и поставить оценку от 0 до 100.

Правила:
1. Оценивай только то, что реально видно на фото. Не додумывай и не дорисовывай.
2. Главное — содержание задания, а не качество фотографии. Плохой свет, беспорядок или неудачный ракурс не должны ронять оценку, если суть видна.
3. Не требуй от человека больше, чем написано в рубрике. Всё, чего нет в рубрике, — не повод снижать балл.
4. Скриншот, фотография экрана, монтаж, стоковое изображение или чужое фото из интернета — это не выполненное задание: score не выше 20, verdict "fail".
5. Если фото вообще не относится к заданию — score 0–20, verdict "fail".
6. Отвечай ТОЛЬКО валидным JSON без markdown, пояснений и текста вокруг.`;

const SCORING_RULES = `КАК СЧИТАТЬ SCORE (сначала проверяй основу, потом добавляй):
1. Обязательная основа не выполнена или выполнена меньше чем наполовину → 20–44.
2. Основа выполнена частично, не хватает одного пункта → 45–69.
3. Вся основа выполнена → 72–79. Это проходной балл.
4. Вся основа + хотя бы половина пунктов «ХОРОШО» → 80–89.
5. Вся основа + все пункты «ХОРОШО» + хотя бы один пункт «БОНУС» → 90–100.
6. Каждый сработавший пункт «СНИЖАЕТ ОЦЕНКУ» вычитает 10–25 баллов, но не ниже 20.
7. Порог прохождения: verdict = "pass" при score >= 70, иначе "fail".
8. confidence — насколько ты уверен в оценке от 0 до 1. Если фото размытое или деталей не видно, ставь ниже 0.6.
9. reason — 1–2 коротких предложения по-русски: что засчитано и чего не хватает. Без воды и без похвалы ради похвалы.`;

const OUTPUT_FORMAT = `ФОРМАТ ОТВЕТА — строго JSON:
{"score": <целое 0..100>, "verdict": "pass" | "fail", "reason": "<1-2 предложения>", "confidence": <0..1>}`;

function bulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

export function buildVerdictPrompt(task: Task): string {
  return [
    VERDICT_SYSTEM_PROMPT,
    '',
    `ЗАДАНИЕ: ${task.title}`,
    `СУТЬ: ${task.description}`,
    `ЧТО ЧЕЛОВЕКУ СКАЗАЛИ СНЯТЬ: ${task.photoHint}`,
    '',
    'ОБЯЗАТЕЛЬНАЯ ОСНОВА (без неё задание не выполнено):',
    bulletList(task.rubric.base),
    '',
    'ХОРОШО, ЕСЛИ НА ФОТО (повышает оценку):',
    bulletList(task.rubric.good),
    '',
    'БОНУС (выводит оценку на 90–100):',
    bulletList(task.rubric.bonus),
    '',
    'СНИЖАЕТ ОЦЕНКУ:',
    bulletList(task.rubric.penalties),
    '',
    SCORING_RULES,
    '',
    OUTPUT_FORMAT,
  ].join('\n');
}

export const VERDICT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 },
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    reason: { type: 'string', maxLength: 300 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['score', 'verdict', 'reason', 'confidence'],
  additionalProperties: false,
} as const;
