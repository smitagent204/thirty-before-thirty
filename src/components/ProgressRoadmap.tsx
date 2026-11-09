import type { CSSProperties } from 'react';

interface ProgressRoadmapProps {
  value: number;
  max: number;
  ready?: boolean;
  caption?: string;
}

export function ProgressRoadmap({ value, max, ready = false, caption }: ProgressRoadmapProps) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;

  return (
    <div className="roadmap">
      <div className="roadmap__head">
        <span>{caption ?? 'Прогресс уровня'}</span>
        <strong>
          {value} / {max}
        </strong>
      </div>
      <div className="roadmap__rail">
        <div className="roadmap__track">
          <div
            className="roadmap__fill"
            style={{ '--p': ratio } as CSSProperties}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={value}
            aria-valuetext={`${value} из ${max}`}
          />
          <span className="roadmap__milestone" style={{ left: '25%' }} />
          <span className="roadmap__milestone" style={{ left: '50%' }} />
          <span className="roadmap__milestone" style={{ left: '75%' }} />
        </div>
        <div className={`roadmap__chest${ready ? ' is-ready' : ''}`} aria-hidden="true">
          {ready ? '🎁' : '📦'}
        </div>
      </div>
    </div>
  );
}
