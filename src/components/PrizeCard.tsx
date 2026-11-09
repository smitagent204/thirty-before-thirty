import { useCallback, useEffect, useState } from 'react';
import { PRIZE_QR_PATH } from '@shared/config';
import { api, ApiError, hasTelegramAuth } from '../api/client';

interface PrizeCardProps {
  isDev?: boolean;
}

type PrizeError = 'chest_locked' | 'prize_not_found' | 'unavailable' | null;

export function PrizeCard({ isDev = false }: PrizeCardProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => hasTelegramAuth());
  const [broken, setBroken] = useState(false);
  const [error, setError] = useState<PrizeError>(null);

  const load = useCallback(async () => {
    // Вне Telegram QR берётся из public — это только локальная разработка.
    if (!hasTelegramAuth()) {
      setSrc(PRIZE_QR_PATH);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await api.prize();
      setSrc(result.image);
      setBroken(false);
    } catch (reason) {
      setSrc(null);
      const code = reason instanceof ApiError ? reason.code : '';
      if (code === 'chest_locked') setError('chest_locked');
      else if (code === 'prize_not_found') setError('prize_not_found');
      else setError('unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();

    const refresh = () => void load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };

    // Владелец загрузил новый QR в dev-панели — обновляем без перезагрузки.
    window.addEventListener('prize-updated', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('prize-updated', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const message =
    isDev && error === 'chest_locked'
      ? 'Приз закрыт: сундук не отмечен открытым на сервере. Отметь все 30 заданий и открой сундук по-настоящему.'
      : isDev && error === 'prize_not_found'
        ? 'QR ещё не загружен. Добавь его в панели разработчика.'
        : isDev && error === 'unavailable'
          ? 'Не удалось получить приз с сервера. Проверь интернет и попробуй ещё раз.'
          : 'QR-сертификат скоро появится здесь.';

  return (
    <div className="prize-wrap">
      <div className="prize-card">
        <span className="prize-card__label">Легендарная награда</span>
        {loading ? (
          <div className="prize-card__qr-missing">
            <span>Загружаем сертификат…</span>
          </div>
        ) : broken || !src ? (
          <div className="prize-card__qr-missing">
            <span>{message}</span>
          </div>
        ) : (
          <img
            className="prize-card__qr"
            src={src}
            alt="QR-код с сертификатом"
            onError={() => setBroken(true)}
          />
        )}
        <p className="prize-card__text">«Ты дошла до 30. Это твой год»</p>
      </div>
      <p className="motivation">
        Тридцать маленьких и больших приключений — это не финиш, а доказательство: у тебя
        хватает смелости, сил и любопытства на всё, что впереди.
      </p>
    </div>
  );
}
