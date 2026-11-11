import { useRef } from 'react';
import { TOTAL_POINTS } from '@shared/levels';
import { CountdownMini } from './Countdown';

interface HeaderProps {
  points: number;
  onUnlockDev: () => void;
  onOpenHall: () => void;
  /** Первый запуск: подсказка, что счётчик стал кликабельным. */
  hallIntro: boolean;
  hallActive: boolean;
}

export function Header({
  points,
  onUnlockDev,
  onOpenHall,
  hallIntro,
  hallActive,
}: HeaderProps) {
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
    <header className={`header${hallIntro ? ' header--intro' : ''}`}>
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
        <button
          type="button"
          className="score score--button"
          onClick={onOpenHall}
          aria-label={`${points} из ${TOTAL_POINTS} баллов. Открыть аллею славы`}
          aria-current={hallActive ? 'page' : undefined}
        >
          <span aria-hidden="true">✦</span>
          {points}
          <span className="score__total">/ {TOTAL_POINTS}</span>
        </button>
      </div>
      <div className="header__row" style={{ marginTop: 6 }}>
        <CountdownMini />
      </div>
      {hallIntro && (
        <div className="hall-intro-cue" role="status">
          <span className="hall-intro__finger" aria-hidden="true">
            👆
          </span>
          <p className="hall-intro__hint">Нажми на счётчик — там аллея славы</p>
        </div>
      )}
    </header>
  );
}
