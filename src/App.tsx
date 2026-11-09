import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { LEVELS, LEVEL_BY_ID, TOTAL_POINTS } from '@shared/levels';
import { computePoints, computeStatuses, tasksOfLevel } from '@shared/progress';
import { TASK_BY_ID } from '@shared/tasks';
import type { LevelId, Task } from '@shared/types';
import { Header } from './components/Header';
import { TabBar } from './components/TabBar';
import { LevelScreen } from './screens/LevelScreen';
import { TaskDetailsSheet } from './components/TaskDetailsSheet';
import { ChestScreen } from './components/ChestScreen';
import { DevPanel } from './components/DevPanel';
import { useProgressStore } from './store/useProgressStore';
import { impact, useTelegram } from './telegram/useTelegram';

function firstAvailableLevel(completed: string[]): LevelId {
  const statuses = computeStatuses(completed);
  const found = LEVELS.find((level) =>
    tasksOfLevel(level.id).some((task) => statuses.get(task.id) === 'available'),
  );
  return found?.id ?? 1;
}

export default function App() {
  useTelegram();

  const completed = useProgressStore((state) => state.completed);
  const chestOpened = useProgressStore((state) => state.chestOpened);
  const devMode = useProgressStore((state) => state.devMode);
  const forceFail = useProgressStore((state) => state.forceFail);
  const markCompleted = useProgressStore((state) => state.markCompleted);
  const completeManually = useProgressStore((state) => state.completeManually);
  const manualCompleted = useProgressStore((state) => state.manualCompleted);
  const openChest = useProgressStore((state) => state.openChest);
  const setDevMode = useProgressStore((state) => state.setDevMode);

  const [tab, setTab] = useState<LevelId | 'chest'>(() =>
    firstAvailableLevel(useProgressStore.getState().completed),
  );
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [devOpen, setDevOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2300);
  };

  const statuses = useMemo(() => computeStatuses(completed), [completed]);
  const points = useMemo(() => computePoints(completed), [completed]);
  const chestReady = points >= TOTAL_POINTS;
  // В dev-режиме сундук можно открыть для репетиции анимации, не собирая 100 баллов.
  const chestPreview = devMode && !chestReady;
  const chestUnlocked = chestReady || chestPreview;

  const availableCounts = useMemo(() => {
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<LevelId, number>;
    for (const level of LEVELS) {
      for (const task of tasksOfLevel(level.id)) {
        if (statuses.get(task.id) === 'available') counts[level.id] += 1;
      }
    }
    return counts;
  }, [statuses]);

  const handleTab = (next: LevelId | 'chest') => {
    impact('light');
    setTab(next);
  };

  const handleOpenTask = (task: Task) => {
    impact('light');
    setSelectedTask(task);
  };

  const handleLocked = () => {
    impact('rigid');
    showToast('Сначала выполни предыдущее задание');
  };

  const handleComplete = (taskId: string) => {
    const task = TASK_BY_ID.get(taskId);
    markCompleted(taskId);
    if (task) showToast(`Задание выполнено: +${task.points}`);
  };

  const handleManualComplete = (taskId: string) => {
    const task = TASK_BY_ID.get(taskId);
    completeManually(taskId);
    if (task) showToast(`Засчитано вручную: +${task.points}`);
  };

  const unlockDev = () => {
    setDevMode(true);
    setDevOpen(true);
    showToast('Режим разработчика включён');
  };

  return (
    <div className="app">
      <Header points={points} onUnlockDev={unlockDev} />

      <main className="main">
        {tab === 'chest' ? (
          <ChestScreen
            points={points}
            ready={chestUnlocked}
            opened={chestOpened && chestReady}
            isDev={devMode}
            preview={chestPreview}
            onOpenChest={openChest}
          />
        ) : (
          <LevelScreen
            level={LEVEL_BY_ID.get(tab) ?? LEVELS[0]}
            completed={completed}
            statuses={statuses}
            onOpenTask={handleOpenTask}
            onLocked={handleLocked}
          />
        )}
      </main>

      <TabBar
        active={tab}
        availableCounts={availableCounts}
        chestReady={chestUnlocked}
        onChange={handleTab}
      />

      <AnimatePresence>
        {selectedTask && (
          <TaskDetailsSheet
            key={selectedTask.id}
            task={selectedTask}
            status={statuses.get(selectedTask.id) ?? 'locked'}
            isDev={devMode}
            isManual={manualCompleted.includes(selectedTask.id)}
            forceFail={forceFail}
            onClose={() => setSelectedTask(null)}
            onComplete={handleComplete}
            onManualComplete={handleManualComplete}
          />
        )}
      </AnimatePresence>

      {devMode && (
        <button type="button" className="dev-fab" onClick={() => setDevOpen(true)}>
          DEV
        </button>
      )}

      {devOpen && <DevPanel onClose={() => setDevOpen(false)} />}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
