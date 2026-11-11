import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { TASKS } from '@shared/tasks';
import type { Task } from '@shared/types';

/** Три копии подряд: средняя — рабочая, крайние дают бесшовный переход по кругу. */
const HALL_CARDS = Array.from({ length: 3 }, (_, copy) =>
  TASKS.map((task) => ({ task, copy })),
).flat();

export interface GalleryEntry {
  image: string | null;
  praise: string | null;
  score: number | null;
  createdAt: string | null;
  manual: boolean;
}

interface HallOfFameProps {
  completed: string[];
  manualCompleted: string[];
  loading: boolean;
  /** В dev-режиме показываем витрину жены. */
  wifeMode?: boolean;
  loadEntry: (task: Task, manual: boolean) => Promise<GalleryEntry>;
  onBack: () => void;
  onOpenTask: (task: Task) => void;
}

function formatDate(value: string | null): string {
  if (!value) return '';
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function HallCard({
  task,
  index,
  completed,
  manual,
  loadEntry,
  onOpenTask,
  onRef,
  onVisualRef,
  scrollRoot,
}: {
  task: Task;
  index: number;
  completed: boolean;
  manual: boolean;
  loadEntry: HallOfFameProps['loadEntry'];
  onOpenTask: (task: Task) => void;
  onRef: (index: number, node: HTMLDivElement | null) => void;
  onVisualRef: (index: number, node: HTMLButtonElement | null) => void;
  scrollRoot: RefObject<HTMLDivElement | null>;
}) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const [entry, setEntry] = useState<GalleryEntry | null>(null);
  const [loading, setLoading] = useState(completed);

  useEffect(() => {
    if (!completed) return;
    const node = slotRef.current;
    if (!node) return;

    let cancelled = false;
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      setLoading(true);
      loadEntry(task, manual)
        .then((value) => {
          if (!cancelled) setEntry(value);
        })
        .catch(() => {
          if (!cancelled) {
            setEntry({
              image: null,
              praise: null,
              score: null,
              createdAt: null,
              manual,
            });
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    if (typeof IntersectionObserver === 'undefined') {
      start();
      return;
    }

    // Фото грузим только когда карточка подъезжает к экрану: 30 base64-кадров
    // разом тянуть нельзя. Root — сам вьюпорт аллеи, иначе обрезка скроллом
    // съедает запас, и кадр начинает грузиться ровно в момент показа.
    // По горизонтали запас — 2–3 карточки, чтобы быстрый свайп не ждал.
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((record) => record.isIntersecting)) {
          start();
          observer.disconnect();
        }
      },
      { root: scrollRoot.current ?? null, rootMargin: '0px 900px' },
    );
    observer.observe(node);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [completed, manual, task, loadEntry, scrollRoot]);

  const date = formatDate(entry?.createdAt ?? null);
  const praise = entry?.praise?.trim();

  return (
    // Слот держит место карточки и точку привязки скролла. Его геометрия не
    // меняется от 3D-трансформации, поэтому scroll-snap всегда попадает в центр.
    <div
      className="hall-card-slot"
      ref={(node) => {
        slotRef.current = node;
        onRef(index, node);
      }}
    >
      <button
        type="button"
        ref={(node) => {
          cardRef.current = node;
          onVisualRef(index, node);
        }}
        className={`hall-card${completed ? ' is-done' : ' is-locked'}`}
        onClick={() => onOpenTask(task)}
        aria-label={`${task.title}. ${
          completed ? 'Выполнено' : 'Ещё не выполнено'
        }. Открыть в списке заданий`}
      >
        <div className="hall-card__frame">
          {completed ? (
            entry?.image ? (
              <img src={entry.image} alt={`${task.title} — выполненное задание`} />
            ) : (
              <div className="hall-card__placeholder" aria-hidden="true">
                🏅
              </div>
            )
          ) : (
            <div className="hall-card__mystery" aria-hidden="true">
              <span>?</span>
            </div>
          )}
          {completed && !loading && entry?.score != null && (
            <span className="hall-card__score">{entry.score}%</span>
          )}
        </div>

        <div className="hall-card__body">
          <span className="hall-card__eyebrow">Уровень {task.level}</span>
          <span className="hall-card__title">{task.title}</span>

          {completed ? (
            <>
              {praise ? (
                <span className="hall-card__praise">{praise}</span>
              ) : (
                <span className="hall-card__praise hall-card__praise--muted">
                  {loading
                    ? 'Загружаем впечатления…'
                    : manual
                      ? 'Засчитано без фото — по коду подтверждения.'
                      : 'Фото и комментарий пока недоступны.'}
                </span>
              )}
              <span className="hall-card__date">
                {date || (loading ? '· · ·' : 'Дата не сохранилась')}
              </span>
            </>
          ) : (
            <>
              <span className="hall-card__praise hall-card__praise--muted">
                Задание ещё впереди. Нажми, чтобы найти его в списке.
              </span>
              <span className="hall-card__date">Ещё не выполнено</span>
            </>
          )}
        </div>
      </button>
    </div>
  );
}

export function HallOfFame({
  completed,
  manualCompleted,
  loading,
  wifeMode,
  loadEntry,
  onBack,
  onOpenTask,
}: HallOfFameProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  /** Слоты: статичная геометрия для замеров и scroll-snap. */
  const slotRefs = useRef<Array<HTMLDivElement | null>>([]);
  /** Карточки внутри слотов: их двигает coverflow-трансформация. */
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const initialised = useRef(false);
  /** Кэшируем сразу промис: три копии не должны тянуть одно фото параллельно. */
  const cacheRef = useRef(new Map<string, Promise<GalleryEntry>>());
  /** Последние записанные стили — не трогаем DOM, если ничего не изменилось. */
  const paintedRef = useRef(new Map<HTMLElement, string>());

  const loadEntryCached = useCallback(
    (task: Task, manual: boolean): Promise<GalleryEntry> => {
      const cached = cacheRef.current.get(task.id);
      if (cached) return cached;
      const request = loadEntry(task, manual).catch((error: unknown) => {
        cacheRef.current.delete(task.id);
        throw error;
      });
      cacheRef.current.set(task.id, request);
      return request;
    },
    [loadEntry],
  );

  const updateCards = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // Считаем по layout-координатам, а не по getBoundingClientRect: у карточек
    // уже есть 3D-трансформация, и её нельзя подмешивать в расчёт смещения.
    const center = viewport.scrollLeft + viewport.clientWidth / 2;

    slotRefs.current.forEach((slot, index) => {
      const card = cardRefs.current[index];
      if (!slot || !card) return;
      const offset = (slot.offsetLeft + slot.offsetWidth / 2 - center) / slot.offsetWidth;
      const distance = Math.min(Math.abs(offset), 2);
      const rotate = Math.max(-32, Math.min(32, -offset * 26));
      const depth = -distance * 46;
      const scale = 1 - distance * 0.075;
      const lift = distance * distance * 7;
      const opacity = Math.max(0.42, 1 - distance * 0.3);
      const zIndex = 100 - Math.round(distance * 10);
      // Дальние карточки всё равно обрезаны вьюпортом. Убираем их из отрисовки:
      // место держит слот, поэтому десятки 3D-слоёв не нагружают скролл.
      const hidden = Math.abs(offset) > 2.6;

      const transform = `translate3d(0, ${lift}px, ${depth}px) rotateY(${rotate}deg) scale(${scale})`;
      const painted = `${transform}|${opacity}|${zIndex}|${hidden}`;
      if (paintedRef.current.get(card) === painted) return;
      paintedRef.current.set(card, painted);

      card.style.transform = transform;
      card.style.opacity = String(opacity);
      card.style.zIndex = String(zIndex);
      card.style.display = hidden ? 'none' : '';
    });
  };

  useEffect(() => {
    if (loading) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    let frame = 0;
    let settle = 0;

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        updateCards();
      });
    };

    const nearestIndex = () => {
      const center = viewport.scrollLeft + viewport.clientWidth / 2;
      let nearest = 0;
      let best = Number.POSITIVE_INFINITY;
      slotRefs.current.forEach((slot, index) => {
        if (!slot) return;
        const distance = Math.abs(slot.offsetLeft + slot.offsetWidth / 2 - center);
        if (distance < best) {
          best = distance;
          nearest = index;
        }
      });
      return nearest;
    };

    /** Какое `scrollLeft` поставит карточку ровно по центру. */
    const centeredLeft = (slot: HTMLElement) =>
      Math.max(
        0,
        Math.min(
          viewport.scrollWidth - viewport.clientWidth,
          slot.offsetLeft - (viewport.clientWidth - slot.offsetWidth) / 2,
        ),
      );

    // Бесшовный круг: доехали до крайней копии — тихо перепрыгиваем на такую же
    // карточку в средней. Визуально ничего не меняется, но скролл не упирается.
    const recenter = () => {
      const first = slotRefs.current[0];
      const middle = slotRefs.current[TASKS.length];
      if (!first || !middle) return;
      const setWidth = middle.offsetLeft - first.offsetLeft;
      if (setWidth <= 0) return;

      const index = nearestIndex();
      if (index < TASKS.length) viewport.scrollLeft += setWidth;
      else if (index >= TASKS.length * 2) viewport.scrollLeft -= setWidth;
      else return;

      schedule();
    };

    const reduceMotion = () =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Когда палец/колесо отпустили, доводим карточку до центра сами. CSS
    // scroll-snap на десктопе иногда бросает скролл между двумя карточками,
    // а при быстром флинге — не докручивает до ближайшей.
    const settleScroll = () => {
      const slot = slotRefs.current[nearestIndex()];
      if (!slot) return;
      const target = centeredLeft(slot);

      if (Math.abs(viewport.scrollLeft - target) > 0.75) {
        viewport.scrollTo({
          left: target,
          behavior: reduceMotion() ? 'auto' : 'smooth',
        });
        return;
      }

      recenter();
    };

    const onScroll = () => {
      schedule();
      if (settle) window.clearTimeout(settle);
      settle = window.setTimeout(settleScroll, 170);
    };

    // Начинаем с первой карточки первого уровня в средней копии.
    if (!initialised.current) {
      initialised.current = true;
      const first = slotRefs.current[TASKS.length];
      if (first) viewport.scrollLeft = centeredLeft(first);
    }

    updateCards();
    viewport.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (settle) window.clearTimeout(settle);
      viewport.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', schedule);
    };
  }, [loading, completed]);

  const doneCount = TASKS.filter((task) => completed.includes(task.id)).length;

  return (
    <div className="hall">
      <div className="hall__head">
        <button
          type="button"
          className="hall__back"
          onClick={onBack}
          aria-label="Вернуться к списку заданий"
        >
          ←
        </button>
        <div>
          <h2 className="hall__title">Аллея славы</h2>
          <p className="hall__sub">
            {loading ? 'Загружаем прогресс…' : `${doneCount} из ${TASKS.length} заданий`}
            {wifeMode && !loading ? ' · прогресс жены' : ''}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="hall__loading">
          <span className="checking__spinner" aria-hidden="true" />
          <span>Собираем витрину…</span>
        </div>
      ) : (
        <div className="hall__viewport" ref={viewportRef}>
          <div className="hall__track">
            {HALL_CARDS.map(({ task, copy }, index) => (
              <HallCard
                key={`${copy}-${task.id}`}
                task={task}
                index={index}
                completed={completed.includes(task.id)}
                manual={manualCompleted.includes(task.id)}
                loadEntry={loadEntryCached}
                onOpenTask={onOpenTask}
                scrollRoot={viewportRef}
                onRef={(cardIndex, node) => {
                  slotRefs.current[cardIndex] = node;
                }}
                onVisualRef={(cardIndex, node) => {
                  cardRefs.current[cardIndex] = node;
                }}
              />
            ))}
          </div>
        </div>
      )}

      <div className="hall__footer">
        <button type="button" className="btn" onClick={onBack}>
          Вернуться к заданиям
        </button>
      </div>
    </div>
  );
}
