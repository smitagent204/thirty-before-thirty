import { useRef } from 'react';
import { TOTAL_POINTS } from '@shared/levels';
import { CountdownMini } from './Countdown';

interface HeaderProps {
  points: number;
  onUnlockDev: () => void;
}

export function Header({ points, onUnlockDev }: HeaderProps) {
  const timer = useRef<number | null>(null);

  const start = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(onUnlockDev, 3000);
  };

  const stop = () => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  return (
    <header className="header">
      <div className="header__row">
        <div
          className="brand"
          onPointerDown={start}
          onPointerUp={stop}
          onPointerLeave={stop}
          onPointerCancel={stop}
        >
          <div className="brand__crest">30</div>
          <div className="brand__text">
            <h1 className="brand__title">30 ДО 30</h1>
            <p className="brand__sub">путь к тридцати</p>
          </div>
        </div>
        <div className="score" aria-label={`${points} из ${TOTAL_POINTS} баллов`}>
          <span aria-hidden="true">✦</span>
          {points}
          <span className="score__total">/ {TOTAL_POINTS}</span>
        </div>
      </div>
      <div className="header__row" style={{ marginTop: 6 }}>
        <CountdownMini />
      </div>
    </header>
  );
}
