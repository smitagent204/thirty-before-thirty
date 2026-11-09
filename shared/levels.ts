import type { LevelMeta } from './types';

export const TOTAL_POINTS = 100;

export const LEVELS: LevelMeta[] = [
  {
    id: 1,
    name: 'Домашний очаг',
    subtitle: 'Домашняя магия и игра с рутиной',
    rarity: 'common',
    rarityLabel: 'Обычный',
    emoji: '🕯️',
    tabLabel: 'Очаг',
  },
  {
    id: 2,
    name: 'Тропы Дыбенко',
    subtitle: 'Квесты на Дыбенко и домашние лаборатории',
    rarity: 'rare',
    rarityLabel: 'Редкий',
    emoji: '🌿',
    tabLabel: 'Район',
    chapters: [
      { afterOrder: 0, title: 'Глава I · Район и вкусы' },
      { afterOrder: 4, title: 'Глава II · Дом и творчество' },
      { afterOrder: 8, title: 'Глава III · Прогулки и тишина' },
      { afterOrder: 11, title: 'Глава IV · Вечера и книги' },
    ],
  },
  {
    id: 3,
    name: 'Городские выходные',
    subtitle: '8 выходных в городе и утренние окна',
    rarity: 'epic',
    rarityLabel: 'Эпический',
    emoji: '🎠',
    tabLabel: 'Город',
  },
  {
    id: 4,
    name: 'Главные приключения',
    subtitle: '4 главных приключения до 30',
    rarity: 'legendary',
    rarityLabel: 'Легендарный',
    emoji: '👑',
    tabLabel: 'Герои',
  },
];

export const LEVEL_BY_ID = new Map(LEVELS.map((level) => [level.id, level]));

/** Сколько задач уровня открыто одновременно */
export function openSlotsForLevel(levelId: LevelMeta['id']): number {
  return levelId === 2 ? 3 : 1;
}
