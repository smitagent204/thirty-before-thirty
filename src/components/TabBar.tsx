import { LEVELS } from '@shared/levels';
import type { LevelId } from '@shared/types';

interface TabBarProps {
  active: LevelId | 'chest';
  availableCounts: Record<LevelId, number>;
  chestReady: boolean;
  onChange: (tab: LevelId | 'chest') => void;
}

export function TabBar({ active, availableCounts, chestReady, onChange }: TabBarProps) {
  return (
    <nav className="tabbar" aria-label="Разделы">
      {LEVELS.map((level) => {
        const isActive = active === level.id;
        return (
          <button
            key={level.id}
            type="button"
            className={`tab${isActive ? ' is-active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onChange(level.id)}
          >
            <span className="tab__icon" aria-hidden="true">
              {level.emoji}
            </span>
            <span className="tab__label">{level.tabLabel}</span>
            {availableCounts[level.id] > 0 && <span className="tab__dot" aria-hidden="true" />}
          </button>
        );
      })}
      <button
        type="button"
        className={`tab is-chest${active === 'chest' ? ' is-active' : ''}${
          chestReady ? ' tab--ready' : ''
        }`}
        aria-current={active === 'chest' ? 'page' : undefined}
        onClick={() => onChange('chest')}
      >
        <span className="tab__icon" aria-hidden="true">
          {chestReady ? '🎁' : '🗝️'}
        </span>
        <span className="tab__label">Сундук</span>
        {chestReady && <span className="tab__dot" aria-hidden="true" />}
      </button>
    </nav>
  );
}
