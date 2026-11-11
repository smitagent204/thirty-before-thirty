import type { AiDeduction } from '@shared/types';

interface VerdictDetailsProps {
  reason?: string;
  deductions?: AiDeduction[];
  compact?: boolean;
}

/** Похвала отдельно от списка минусов: так оценка читается спокойно и честно. */
export function VerdictDetails({ reason, deductions, compact }: VerdictDetailsProps) {
  const items = deductions ?? [];
  if (!reason && items.length === 0) return null;

  return (
    <div className={`verdict-details${compact ? ' verdict-details--compact' : ''}`}>
      {reason && <p className="verdict-details__praise">{reason}</p>}
      {items.length > 0 && (
        <ul className="verdict-details__list" aria-label="Что не засчитано">
          {items.map((item, index) => (
            <li
              className="verdict-details__item"
              key={`${item.id ?? item.label}-${item.percent}-${index}`}
            >
              <span className="verdict-details__percent">−{item.percent}%</span>
              <span className="verdict-details__label">{item.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
