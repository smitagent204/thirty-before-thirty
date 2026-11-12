import { useState } from 'react';
import { TASK_BY_ID } from '@shared/tasks';
import type { AiDeduction, TaskRequirement } from '@shared/types';

interface VerdictDetailsProps {
  reason?: string;
  deductions?: AiDeduction[];
  compact?: boolean;
  /** Задание нужно, чтобы показать полное требование рубрики у каждого минуса. */
  taskId?: string;
  /** Только для dev-панели: убрать конкретный минус, если ИИ ошибся. */
  onDismiss?: (item: AiDeduction) => void;
}

/** Похвала отдельно от списка минусов: так оценка читается спокойно и честно. */
export function VerdictDetails({
  reason,
  deductions,
  compact,
  taskId,
  onDismiss,
}: VerdictDetailsProps) {
  const items = deductions ?? [];
  const [openKey, setOpenKey] = useState<string | null>(null);
  if (!reason && items.length === 0) return null;

  const requirements = taskId ? TASK_BY_ID.get(taskId)?.rubric.required ?? [] : [];
  const requirementFor = (item: AiDeduction): TaskRequirement | undefined =>
    item.id ? requirements.find((entry) => entry.id === item.id) : undefined;

  return (
    <div className={`verdict-details${compact ? ' verdict-details--compact' : ''}`}>
      {reason && <p className="verdict-details__praise">{reason}</p>}
      {items.length > 0 && (
        <ul className="verdict-details__list" aria-label="Что не засчитано">
          {items.map((item, index) => {
            const key = `${item.id ?? item.label}-${index}`;
            const requirement = requirementFor(item);
            const open = openKey === key;
            return (
              <li className="verdict-details__item" key={key}>
                <div className="verdict-details__row">
                  <span className="verdict-details__percent">−{item.percent}%</span>
                  {requirement ? (
                    <button
                      type="button"
                      className="verdict-details__label verdict-details__label--button"
                      onClick={() => setOpenKey(open ? null : key)}
                      aria-expanded={open}
                    >
                      {item.label}
                      <span className="verdict-details__more">
                        {open ? 'свернуть' : 'что проверяли'}
                      </span>
                    </button>
                  ) : (
                    <span className="verdict-details__label">{item.label}</span>
                  )}
                  {onDismiss && (
                    <button
                      type="button"
                      className="verdict-details__dismiss"
                      onClick={() => onDismiss(item)}
                      aria-label={`Убрать минус: ${item.label}`}
                      title="ИИ ошибся — убрать этот минус"
                    >
                      ×
                    </button>
                  )}
                </div>
                {open && requirement && (
                  <div className="verdict-details__why">
                    <p className="verdict-details__why-row">
                      <span className="verdict-details__why-title">Требование</span>
                      {requirement.label}
                    </p>
                    <p className="verdict-details__why-row">
                      <span className="verdict-details__why-title">Не засчитано</span>
                      {item.label}
                    </p>
                    <p className="verdict-details__why-row">
                      <span className="verdict-details__why-title">Вес пункта</span>
                      до {requirement.weight}%
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
