import { useState } from 'react';
import { PRIZE_QR_PATH } from '@shared/config';

interface PrizeCardProps {
  isDev?: boolean;
}

export function PrizeCard({ isDev = false }: PrizeCardProps) {
  const [broken, setBroken] = useState(false);

  return (
    <div className="prize-wrap">
      <div className="prize-card">
        <span className="prize-card__label">Легендарная награда</span>
        {broken ? (
          <div className="prize-card__qr-missing">
            <span>
              QR-сертификат скоро появится здесь.
              {isDev && (
                <>
                  <br />
                  <code>{PRIZE_QR_PATH}</code>
                </>
              )}
            </span>
          </div>
        ) : (
          <img
            className="prize-card__qr"
            src={PRIZE_QR_PATH}
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
