import { useEffect, useMemo, useState } from 'react';
import { DEADLINE_ISO } from '@shared/config';

interface Parts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
}

function split(target: number, now: number): Parts {
  const ms = Math.max(0, target - now);
  const totalSeconds = Math.floor(ms / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    expired: ms <= 0,
  };
}

export function useCountdown(iso: string = DEADLINE_ISO): Parts {
  const target = useMemo(() => new Date(iso).getTime(), [iso]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return split(target, now);
}

export function CountdownMini() {
  const { days, expired } = useCountdown();
  return (
    <span className="countdown">
      {expired ? 'время вышло' : 'до финиша'}
      {!expired && <strong>{days} дн</strong>}
    </span>
  );
}

export function CountdownGrid() {
  const { days, hours, minutes, seconds, expired } = useCountdown();

  if (expired) {
    return <p className="countdown countdown--big">Время челленджа истекло</p>;
  }

  const cells = [
    { value: days, label: 'дней' },
    { value: hours, label: 'часов' },
    { value: minutes, label: 'минут' },
    { value: seconds, label: 'секунд' },
  ];

  return (
    <div className="countdown-grid" aria-label="Обратный отсчёт до 10 января 2027">
      {cells.map((cell) => (
        <div className="countdown-cell" key={cell.label}>
          <span className="countdown-cell__value">{String(cell.value).padStart(2, '0')}</span>
          <span className="countdown-cell__label">{cell.label}</span>
        </div>
      ))}
    </div>
  );
}
