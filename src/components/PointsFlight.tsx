import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  landStar,
  subscribeFlights,
  type PointFlight,
} from '../lib/pointsFlight';

/** Пауза между звёздами: каждая следующая вылетает следом за предыдущей. */
const STAGGER_MS = 72;
/** Время полёта одной звезды. */
const FLIGHT_MS = 560;
/** Небольшой хвост после последней звезды, чтобы успеть убрать разметку. */
const TAIL_MS = 260;

interface StarPath {
  /** Смещение точки вылета от центра кнопки. */
  sx: number;
  sy: number;
  /** Смещение счётчика относительно кнопки. */
  dx: number;
  dy: number;
  /** Средняя точка дуги: звёзды летят не по прямой. */
  midX: number;
  midY: number;
  size: number;
  spin: number;
}

/**
 * Пути звёзд: вылетают из точки кнопки врассыпную и по дуге сходятся к
 * счётчику. Дуга у каждой своя, поэтому стайка не выглядит строем.
 */
function buildPaths(flight: PointFlight): StarPath[] {
  const dx = flight.to.x - flight.from.x;
  const dy = flight.to.y - flight.from.y;
  const length = Math.hypot(dx, dy) || 1;
  // Перпендикуляр к линии «кнопка → счётчик» задаёт сторону дуги.
  const nx = -dy / length;
  const ny = dx / length;

  return Array.from({ length: flight.count }, (_, index) => {
    const bend = (index % 2 === 0 ? 1 : -1) * (26 + Math.random() * 44);
    return {
      sx: (Math.random() - 0.5) * 48,
      sy: (Math.random() - 0.5) * 36,
      dx,
      dy,
      midX: dx * 0.5 + nx * bend,
      midY: dy * 0.5 + ny * bend,
      size: 13 + Math.random() * 6,
      spin: (Math.random() - 0.5) * 240,
    };
  });
}

function Burst({ flight }: { flight: PointFlight }) {
  const paths = useMemo(() => buildPaths(flight), [flight]);

  return (
    <>
      {paths.map((path, index) => (
        <motion.span
          key={`${flight.id}-${index}`}
          className="points-flight__star"
          style={{
            left: flight.from.x,
            top: flight.from.y,
            fontSize: path.size,
          }}
          initial={{ x: path.sx, y: path.sy, scale: 0.35, opacity: 0, rotate: 0 }}
          animate={{
            // У всех значений одинаковое число кадров: times задаётся один раз.
            x: [path.sx, path.midX, path.dx * 0.94, path.dx],
            y: [path.sy, path.midY, path.dy * 0.94, path.dy],
            scale: [0.35, 1.15, 0.85, 0.5],
            opacity: [0, 1, 1, 0],
            rotate: path.spin,
          }}
          transition={{
            duration: FLIGHT_MS / 1000,
            delay: (index * STAGGER_MS) / 1000,
            times: [0, 0.28, 0.82, 1],
            ease: 'easeInOut',
          }}
        >
          ✦
        </motion.span>
      ))}
    </>
  );
}

/**
 * Слой полёта звёзд. Живёт поверх шторки: кнопка «Забрать» исчезает вместе с
 * листом, а звёзды должны долететь до шапки. Прилёт каждой звезды считается
 * по таймеру — ровно в тот момент, когда её анимация заканчивается.
 */
export function PointsFlight() {
  const [flights, setFlights] = useState<PointFlight[]>([]);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    return subscribeFlights((flight) => {
      setFlights((prev) => [...prev, flight]);

      for (let index = 0; index < flight.count; index += 1) {
        timers.current.push(
          window.setTimeout(landStar, index * STAGGER_MS + FLIGHT_MS),
        );
      }

      const lifetime = flight.count * STAGGER_MS + FLIGHT_MS + TAIL_MS;
      timers.current.push(
        window.setTimeout(() => {
          setFlights((prev) => prev.filter((item) => item.id !== flight.id));
        }, lifetime),
      );
    });
  }, []);

  useEffect(() => {
    return () => {
      for (const id of timers.current) window.clearTimeout(id);
      timers.current = [];
    };
  }, []);

  if (flights.length === 0) return null;

  return (
    <div className="points-flight" aria-hidden="true">
      {flights.map((flight) => (
        <Burst key={flight.id} flight={flight} />
      ))}
    </div>
  );
}
