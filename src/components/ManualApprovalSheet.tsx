import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { MANUAL_PIN_LENGTH } from '../config';
import { impact, notify } from '../telegram/useTelegram';

interface ManualApprovalSheetProps {
  onClose: () => void;
  /** Проверяет код на сервере. Возвращает true, если задание засчитано. */
  onSubmit: (pin: string) => Promise<boolean>;
  onSuccess: () => void;
}

export function ManualApprovalSheet({ onClose, onSubmit, onSuccess }: ManualApprovalSheetProps) {
  const [digits, setDigits] = useState<string[]>(() => Array(MANUAL_PIN_LENGTH).fill(''));
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  const code = digits.join('');

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  const update = (index: number, value: string) => {
    setDigits((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleChange = (index: number, event: ChangeEvent<HTMLInputElement>) => {
    const clean = event.target.value.replace(/\D/g, '');
    setError(false);

    if (!clean) {
      update(index, '');
      return;
    }

    if (clean.length > 1) {
      const next = [...digits];
      clean
        .slice(0, MANUAL_PIN_LENGTH - index)
        .split('')
        .forEach((char, offset) => {
          next[index + offset] = char;
        });
      setDigits(next);
      const lastIndex = Math.min(index + clean.length, MANUAL_PIN_LENGTH - 1);
      refs.current[lastIndex]?.focus();
      return;
    }

    update(index, clean);
    if (index < MANUAL_PIN_LENGTH - 1) refs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      event.preventDefault();
      update(index - 1, '');
      refs.current[index - 1]?.focus();
    }
    if (event.key === 'Enter') {
      void submit();
    }
  };

  const submit = async () => {
    if (busy || code.length !== MANUAL_PIN_LENGTH) return;
    impact('light');
    setBusy(true);
    let ok = false;
    try {
      ok = await onSubmit(code);
    } finally {
      setBusy(false);
    }

    if (ok) {
      impact('medium');
      notify('success');
      onSuccess();
      return;
    }

    impact('rigid');
    notify('error');
    setError(true);
    setShakeKey((key) => key + 1);
    setDigits(Array(MANUAL_PIN_LENGTH).fill(''));
    window.setTimeout(() => refs.current[0]?.focus(), 0);
  };

  return (
    <div className="sheet-layer sheet-layer--nested">
      <div className="scrim" onClick={onClose} />
      <div className="sheet sheet--compact">
        <div className="sheet__handle" />
        <div className="sheet__head">
          <div className="sheet__head-text">
            <div className="sheet__eyebrow">
              <span
                className="rarity"
                style={
                  {
                    '--rarity': 'var(--c-gold-500)',
                    '--rarity-light': 'var(--c-gold-100)',
                  } as CSSProperties
                }
              >
                🔑 подтверждение
              </span>
            </div>
            <h3 className="sheet__title">Засчитать вручную</h3>
          </div>
          <button type="button" className="sheet__close" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>

        <div className="sheet__body">
          <p className="sheet__text">
            Попроси мужа ввести код из шести цифр. Это подтвердит, что задание действительно
            выполнено, — даже если фото нет или проверка его не приняла.
          </p>

          <div className={`pin-row${error ? ' is-error' : ''}`} key={shakeKey}>
            {digits.map((digit, index) => (
              <input
                key={index}
                ref={(element) => {
                  refs.current[index] = element;
                }}
                className="pin-cell"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={1}
                value={digit}
                autoComplete={index === 0 ? 'one-time-code' : 'off'}
                aria-label={`Цифра ${index + 1}`}
                onChange={(event) => handleChange(index, event)}
                onKeyDown={(event) => handleKeyDown(index, event)}
              />
            ))}
          </div>

          {error && (
            <p className="pin-error" aria-live="polite">
              Не удалось подтвердить. Проверь код и попробуй ещё раз.
            </p>
          )}
        </div>

        <div className="sheet__footer">
          <button
            type="button"
            className="btn"
            disabled={code.length !== MANUAL_PIN_LENGTH || busy}
            onClick={() => void submit()}
          >
            {busy ? 'Проверяем…' : 'Подтвердить'}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            style={{ marginTop: 10 }}
            onClick={onClose}
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
