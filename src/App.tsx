import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { LEVELS, LEVEL_BY_ID, TOTAL_POINTS } from '@shared/levels';
import { computePoints, computeStatuses, tasksOfLevel } from '@shared/progress';
import { TASK_BY_ID } from '@shared/tasks';
import type { LevelId, Task } from '@shared/types';
import { Header } from './components/Header';
import { TabBar } from './components/TabBar';
import { HallOfFame, type GalleryEntry } from './components/HallOfFame';
import { LevelScreen } from './screens/LevelScreen';
import { TaskDetailsSheet } from './components/TaskDetailsSheet';
import { ChestScreen } from './components/ChestScreen';
import { DevPanel } from './components/DevPanel';
import { useProgressStore } from './store/useProgressStore';
import { impact, useTelegram } from './telegram/useTelegram';
import { api, ApiError, type WifeState } from './api/client';
import { loadPhoto, warmPhotos } from './api/photoCache';
import { MANUAL_APPROVAL_PIN } from './config';

function firstAvailableLevel(completed: string[]): LevelId {
  const statuses = computeStatuses(completed);
  const found = LEVELS.find((level) =>
    tasksOfLevel(level.id).some((task) => statuses.get(task.id) === 'available'),
  );
  return found?.id ?? 1;
}

export default function App() {
  const telegram = useTelegram();
  const initData = telegram.initData;

  const completed = useProgressStore((state) => state.completed);
  const chestOpened = useProgressStore((state) => state.chestOpened);
  const devMode = useProgressStore((state) => state.devMode);
  const forceFail = useProgressStore((state) => state.forceFail);
  const markCompleted = useProgressStore((state) => state.markCompleted);
  const completeManually = useProgressStore((state) => state.completeManually);
  const manualCompleted = useProgressStore((state) => state.manualCompleted);
  const openChest = useProgressStore((state) => state.openChest);
  const setDevMode = useProgressStore((state) => state.setDevMode);
  const hydrate = useProgressStore((state) => state.hydrate);
  const isOwner = useProgressStore((state) => state.isOwner);
  const hallIntroSeen = useProgressStore((state) => state.hallIntroSeen);
  const markHallIntroSeen = useProgressStore((state) => state.markHallIntroSeen);

  const [tab, setTab] = useState<LevelId | 'chest'>(() =>
    firstAvailableLevel(useProgressStore.getState().completed),
  );
  const [view, setView] = useState<'tasks' | 'hall'>('tasks');
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const [hallWife, setHallWife] = useState<WifeState | null>(null);
  const [hallWifeLoading, setHallWifeLoading] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [devOpen, setDevOpen] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
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

  useEffect(() => {
    if (!initData) return;
    let cancelled = false;

    api
      .state()
      .then((state) => {
        if (!cancelled) hydrate(state);
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) {
          setAccessDenied(true);
          return;
        }
        showToast('Не удалось синхронизировать прогресс');
      });

    return () => {
      cancelled = true;
    };
  }, [initData, hydrate]);

  const statuses = useMemo(() => computeStatuses(completed), [completed]);
  const points = useMemo(() => computePoints(completed), [completed]);
  const chestReady = points >= TOTAL_POINTS;
  const serverAuth = Boolean(initData);
  const devAllowed = !serverAuth || isOwner;
  const devActive = devMode && devAllowed;
  // В dev-режиме сундук можно открыть для репетиции анимации, не собирая 100 баллов.
  const chestPreview = devActive && !chestReady;
  const chestUnlocked = chestReady || chestPreview;

  // В dev-режиме аллея показывает достижения жены, а не владельца.
  const showWifeHall = Boolean(devActive && serverAuth && hallWife?.configured);
  const hallLoading = devActive && serverAuth && hallWifeLoading;

  // Фото выполненных заданий один раз догружаем в фоне. Дальше и шторка задания,
  // и аллея славы берут их из общего кэша — без повторных запросов.
  useEffect(() => {
    if (!serverAuth) return;
    const photoTaskIds = completed.filter((id) => !manualCompleted.includes(id));
    if (photoTaskIds.length > 0) warmPhotos(photoTaskIds);
  }, [completed, manualCompleted, serverAuth]);

  useEffect(() => {
    if (view !== 'hall' || !devActive || !serverAuth) return;
    let cancelled = false;
    setHallWifeLoading(true);
    api
      .wife()
      .then((state) => {
        if (!cancelled) setHallWife(state);
      })
      .catch(() => {
        if (!cancelled) setHallWife(null);
      })
      .finally(() => {
        if (!cancelled) setHallWifeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view, devActive, serverAuth]);

  const loadHallEntry = useCallback(
    async (task: Task, manual: boolean): Promise<GalleryEntry> => {
      const empty: GalleryEntry = {
        image: null,
        praise: null,
        score: null,
        createdAt: null,
        manual,
      };

      if (showWifeHall) {
        try {
          const state = await api.wifeTask(task.id);
          return {
            image: state.photo?.image ?? null,
            praise: state.photo?.reason ?? null,
            score: state.photo?.score ?? null,
            createdAt: state.createdAt ?? state.photo?.createdAt ?? null,
            manual: state.manual,
          };
        } catch {
          return empty;
        }
      }

      if (manual || !serverAuth) return empty;

      try {
        const photo = await loadPhoto(task.id);
        return {
          image: photo.image,
          praise: photo.reason ?? null,
          score: photo.score,
          createdAt: photo.createdAt,
          manual: false,
        };
      } catch {
        return empty;
      }
    },
    [serverAuth, showWifeHall],
  );

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

  const openHall = () => {
    impact('light');
    // Повторное нажатие на счётчик уже внутри аллеи не должно заново включать
    // загрузку: эффект ниже не перезапустится (view не меняется), и спиннер
    // останется навсегда.
    if (view === 'hall') return;
    markHallIntroSeen();
    if (devActive && serverAuth) setHallWifeLoading(true);
    setView('hall');
  };

  const closeHall = () => {
    impact('light');
    setView('tasks');
  };

  const handleHallTask = useCallback((task: Task) => {
    impact('light');
    setTab(task.level);
    setView('tasks');
    setFocusTaskId(task.id);
  }, []);

  const clearFocus = useCallback(() => setFocusTaskId(null), []);

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

  const handleManualComplete = async (taskId: string, pin: string): Promise<boolean> => {
    const task = TASK_BY_ID.get(taskId);
    if (!task) return false;

    // Вне Telegram (локальная разработка) — прежнее поведение без сервера.
    if (!serverAuth) {
      if (pin !== MANUAL_APPROVAL_PIN) return false;
      completeManually(taskId);
      showToast(`Засчитано вручную: +${task.points}`);
      return true;
    }

    try {
      const state = await api.manual(taskId, pin);
      hydrate(state);
      showToast(`Засчитано вручную: +${task.points}`);
      return true;
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'invalid_pin') {
          showToast('Неверный код подтверждения');
        } else if (error.code === 'already_completed') {
          showToast('Это задание уже выполнено');
        } else if (error.code === 'task_locked') {
          showToast('Сначала выполни предыдущее задание');
        } else {
          showToast('Не удалось подтвердить задание');
        }
      } else {
        showToast('Не удалось подтвердить задание');
      }
      return false;
    }
  };

  /** Сервер уже записал результат проверки — подтягиваем актуальное состояние. */
  const syncState = async (): Promise<void> => {
    if (!serverAuth) return;
    try {
      hydrate(await api.state());
    } catch {
      // при следующем открытии приложение снова запросит состояние
    }
  };

  const handleDevComplete = async (taskId: string): Promise<void> => {
    if (!serverAuth) {
      markCompleted(taskId);
      return;
    }
    try {
      const state = await api.dev('toggle', { taskId });
      hydrate(state);
    } catch {
      showToast('Не удалось изменить прогресс на сервере');
    }
  };

  const handleOpenChest = async (): Promise<boolean> => {
    if (chestPreview || !serverAuth) {
      openChest();
      return true;
    }
    try {
      const state = await api.openChest();
      hydrate(state);
      openChest();
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'chest_locked') {
        showToast('Сундук откроется, когда будет 100 баллов');
      } else {
        showToast('Не удалось открыть сундук');
      }
      return false;
    }
  };

  const unlockDev = () => {
    if (serverAuth && !isOwner) {
      showToast('Режим разработчика недоступен');
      return;
    }
    setDevMode(true);
    setDevOpen(true);
    showToast('Режим разработчика включён');
  };

  if (accessDenied) {
    return (
      <div className="app">
        <div className="server-gate">
          <div className="server-gate__crest">30</div>
          <h1 className="server-gate__title">Доступ закрыт</h1>
          <p className="server-gate__text">
            Это приложение создано для одного человека. Если тебе прислали ссылку — попроси
            автора открыть доступ.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Header
        points={points}
        onUnlockDev={unlockDev}
        onOpenHall={openHall}
        hallIntro={!hallIntroSeen}
        hallActive={view === 'hall'}
      />

      <main className="main">
        {view === 'hall' ? (
          <HallOfFame
            completed={showWifeHall ? hallWife?.completed ?? [] : completed}
            manualCompleted={
              showWifeHall ? hallWife?.manualCompleted ?? [] : manualCompleted
            }
            loading={hallLoading}
            wifeMode={showWifeHall}
            loadEntry={loadHallEntry}
            onBack={closeHall}
            onOpenTask={handleHallTask}
          />
        ) : tab === 'chest' ? (
          <ChestScreen
            points={points}
            ready={chestUnlocked}
            opened={chestOpened && chestReady}
            isDev={devActive}
            preview={chestPreview}
            onOpenChest={handleOpenChest}
          />
        ) : (
          <LevelScreen
            level={LEVEL_BY_ID.get(tab) ?? LEVELS[0]}
            completed={completed}
            statuses={statuses}
            focusTaskId={focusTaskId}
            onFocusHandled={clearFocus}
            onOpenTask={handleOpenTask}
            onLocked={handleLocked}
          />
        )}
      </main>

      {view === 'tasks' && (
        <TabBar
          active={tab}
          availableCounts={availableCounts}
          chestReady={chestUnlocked}
          onChange={handleTab}
        />
      )}

      <AnimatePresence>
        {selectedTask && (
          <TaskDetailsSheet
            key={selectedTask.id}
            task={selectedTask}
            status={statuses.get(selectedTask.id) ?? 'locked'}
            isDev={devActive}
            isManual={manualCompleted.includes(selectedTask.id)}
            forceFail={forceFail}
            onClose={() => setSelectedTask(null)}
            onComplete={handleComplete}
            onChecked={syncState}
            onDevComplete={handleDevComplete}
            onManualComplete={handleManualComplete}
          />
        )}
      </AnimatePresence>

      {devActive && (
        <button type="button" className="dev-fab" onClick={() => setDevOpen(true)}>
          DEV
        </button>
      )}

      {devOpen && devActive && <DevPanel onClose={() => setDevOpen(false)} />}

      {!hallIntroSeen && <div className="hall-intro" aria-hidden="true" />}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
