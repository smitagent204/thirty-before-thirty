/**
 * Полёт звёзд от кнопки «Забрать» к счётчику в шапке.
 *
 * Баллы в сторе прибавляются сразу, но пока звёзды летят, Header вычитает
 * «задержанные» баллы (`withheld`) и показывает только долетевшие. Поэтому
 * число растёт по одной звезде, а не прыгает на всю сумму.
 */

export interface PointFlight {
  id: number;
  /** Центр кнопки в момент нажатия, viewport-координаты. */
  from: { x: number; y: number };
  /** Центр счётчика. */
  to: { x: number; y: number };
  count: number;
}

/** Атрибут на элементе счётчика: по нему ищем, куда лететь. */
export const SCORE_TARGET_ATTR = 'data-score-target';

let withheld = 0;
let sequence = 0;

const withheldListeners = new Set<() => void>();
const flightListeners = new Set<(flight: PointFlight) => void>();

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function setWithheld(next: number): void {
  const value = Math.max(0, next);
  if (value === withheld) return;
  withheld = value;
  for (const listener of withheldListeners) listener();
}

/** Счётчик подписывается, чтобы лишние баллы не появлялись раньше звёзд. */
export function subscribeWithheld(listener: () => void): () => void {
  withheldListeners.add(listener);
  return () => {
    withheldListeners.delete(listener);
  };
}

export function getWithheld(): number {
  return withheld;
}

/** Слой анимации подписывается на новые полёты. */
export function subscribeFlights(listener: (flight: PointFlight) => void): () => void {
  flightListeners.add(listener);
  return () => {
    flightListeners.delete(listener);
  };
}

export function resolveScoreTarget(): { x: number; y: number } | null {
  if (typeof document === 'undefined') return null;
  const node = document.querySelector(`[${SCORE_TARGET_ATTR}]`);
  if (!(node instanceof HTMLElement)) return null;
  const rect = node.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Запускает полёт. false — анимация не нужна или невозможна (нет кнопки,
 * нет счётчика, включён режим уменьшенного движения): счётчик обновится сразу.
 */
export function launchPointsFlight(
  from: { x: number; y: number } | null,
  count: number,
): boolean {
  if (!from || count <= 0 || reducedMotion()) return false;
  const to = resolveScoreTarget();
  if (!to) return false;

  sequence += 1;
  const flight: PointFlight = { id: sequence, from, to, count };
  setWithheld(withheld + count);
  for (const listener of flightListeners) listener(flight);
  return true;
}

/** Звезда долетела: счётчик прибавляет единицу. */
export function landStar(): void {
  setWithheld(withheld - 1);
}
