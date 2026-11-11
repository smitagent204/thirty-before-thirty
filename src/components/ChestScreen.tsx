import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { TOTAL_POINTS } from '@shared/levels';
import { ProgressRoadmap } from './ProgressRoadmap';
import { CountdownGrid } from './Countdown';
import { PrizeCard } from './PrizeCard';
import { impact, notify } from '../telegram/useTelegram';

type Phase = 'idle' | 'shaking' | 'opening' | 'open';

interface ChestScreenProps {
  points: number;
  ready: boolean;
  opened: boolean;
  isDev: boolean;
  /** Репетиция в dev-режиме: открытие не сохраняется. */
  preview: boolean;
  /** Сохраняет открытие на сервере. false — открыть не удалось. */
  onOpenChest: () => Promise<boolean>;
}

interface Particle {
  id: number;
  dx: number;
  dy: number;
  size: number;
  color: string;
  delay: number;
}

export function ChestScreen({
  points,
  ready,
  opened,
  isDev,
  preview,
  onOpenChest,
}: ChestScreenProps) {
  const [phase, setPhase] = useState<Phase>(opened ? 'open' : 'idle');
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (opened) setPhase('open');
  }, [opened]);

  useEffect(() => {
    return () => {
      timers.current.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  const particles = useMemo<Particle[]>(() => {
    const palette = ['#ffd75e', '#ffe9a8', '#63d471', '#57e0ff', '#a55cff'];
    return Array.from({ length: 26 }, (_, index) => {
      const angle = (index / 26) * Math.PI * 2 + Math.random() * 0.5;
      const distance = 70 + Math.random() * 130;
      return {
        id: index,
        dx: Math.cos(angle) * distance,
        dy: Math.sin(angle) * distance - 26,
        size: 5 + Math.random() * 8,
        color: palette[index % palette.length],
        delay: Math.round(Math.random() * 180),
      };
    });
  }, []);

  const finish = async () => {
    if (!preview) {
      const ok = await onOpenChest();
      if (!ok) {
        setPhase('idle');
        return;
      }
    }
    setPhase('open');
    notify('success');
  };

  const open = () => {
    if (!ready || phase !== 'idle') return;
    impact('heavy');
    setPhase('shaking');
    const first = window.setTimeout(() => {
      setPhase('opening');
      notify('warning');
    }, 720);
    const second = window.setTimeout(() => {
      void finish();
    }, 2600);
    timers.current.push(first, second);
  };

  const skip = () => {
    if (phase !== 'opening') return;
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    void finish();
  };

  const chestClass = [
    'chest',
    ready && phase === 'idle' ? 'is-ready' : '',
    phase === 'shaking' ? 'is-shaking' : '',
    phase === 'opening' ? 'is-opening' : '',
    phase === 'open' ? 'is-open' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const remaining = Math.max(0, TOTAL_POINTS - points);

  return (
    <div className="screen">
      <div className="chest-screen">
        <h2 className="chest-title">Сундук тридцати</h2>
        <p className="chest-sub">
          {phase === 'open'
            ? 'Сундук открыт. Забери свою награду.'
            : preview
              ? 'Режим разработчика: репетиция открытия. Результат не сохраняется.'
              : ready
                ? 'Все тридцать заданий позади. Сундук готов открыться.'
                : `До награды осталось ${remaining} ${plural(remaining)}.`}
        </p>

        {!ready && <CountdownGrid />}

        <AnimatePresence mode="wait" initial={false}>
          {phase !== 'open' ? (
            <motion.div
              key="chest"
              className="chest-stage"
              onClick={phase === 'idle' && ready ? open : skip}
              role="presentation"
              exit={{ opacity: 0, scale: 0.72, y: 26, transition: { duration: 0.3 } }}
            >
              <div className={chestClass}>
                <div className="chest__glow" />
                <div className="chest__lid" />
                <div className="chest__base">
                  <span className="chest__band chest__band--left" />
                  <span className="chest__band chest__band--right" />
                </div>
                <div className="chest__lock">🔒</div>
                {particles.map((particle) => (
                  <span
                    key={particle.id}
                    className="particle"
                    style={
                      {
                        '--dx': `${particle.dx}px`,
                        '--dy': `${particle.dy}px`,
                        '--size': `${particle.size}px`,
                        '--color': particle.color,
                        '--delay': `${particle.delay}ms`,
                      } as CSSProperties
                    }
                  />
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="prize"
              className="chest-stage chest-stage--prize"
              initial={{ opacity: 0, scale: 0.16, y: 90, rotate: -7 }}
              animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 170, damping: 17, mass: 0.9 }}
            >
              <PrizeCard isDev={isDev} />
            </motion.div>
          )}
        </AnimatePresence>

        <div className={phase === 'opening' ? 'flash is-on' : 'flash'} aria-hidden="true" />

        {phase !== 'open' && (
          <div style={{ width: '100%', marginTop: 6 }}>
            <ProgressRoadmap
              value={preview ? TOTAL_POINTS : points}
              max={TOTAL_POINTS}
              ready={ready}
              caption="Общий прогресс"
            />
          </div>
        )}

        {!opened && phase !== 'open' && (
          <button
            type="button"
            className="btn"
            style={{ marginTop: 14 }}
            disabled={!ready || phase !== 'idle'}
            onClick={open}
          >
            {!ready
              ? 'Собери все 100 баллов'
              : phase === 'shaking'
                ? 'Сундук дрожит…'
                : phase === 'opening'
                  ? 'Открывается…'
                  : 'Открыть сундук'}
          </button>
        )}

      </div>
    </div>
  );
}

function plural(value: number): string {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return 'балл';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'балла';
  return 'баллов';
}
