import { useEffect, useState } from 'react';
import { PRIZE_QR_PATH } from '@shared/config';
import { api, hasTelegramAuth } from '../api/client';

interface PrizeCardProps {
  isDev?: boolean;
}

export function PrizeCard({ isDev = false }: PrizeCardProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => hasTelegramAuth());
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    // Вне Telegram QR берётся из public — это только локальная разработка.
    if (!hasTelegramAuth()) {
      setSrc(PRIZE_QR_PATH);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    api
      .prize()
      .then((result) => {
        if (!cancelled) setSrc(result.image);
      })
      .catch(() => {
        // 403 — сундук ещё не открыт на сервере, 404 — приз не загружен.
        if (!cancelled) setSrc(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
            <span>
              QR-сертификат скоро появится здесь.
              {isDev && (
                <>
                  <br />
                  Загрузи его в панели разработчика.
                </>
              )}
            </span>
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
