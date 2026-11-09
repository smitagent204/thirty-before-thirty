import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { TASKS } from '@shared/tasks';
import { isDevRequested } from '../telegram/useTelegram';

interface ProgressState {
  completed: string[];
  /** Задания, засчитанные вручную по коду подтверждения */
  manualCompleted: string[];
  chestOpened: boolean;
  devMode: boolean;
  forceFail: boolean;
  markCompleted: (taskId: string) => void;
  completeManually: (taskId: string) => void;
  toggleCompleted: (taskId: string) => void;
  completeAll: () => void;
  reset: () => void;
  openChest: () => void;
  setDevMode: (value: boolean) => void;
  setForceFail: (value: boolean) => void;
}

const ALL_TASK_IDS = TASKS.map((task) => task.id);

export const useProgressStore = create<ProgressState>()(
  persist(
    (set) => ({
      completed: [],
      manualCompleted: [],
      chestOpened: false,
      devMode: isDevRequested(),
      forceFail: false,

      markCompleted: (taskId) =>
        set((state) =>
          state.completed.includes(taskId)
            ? state
            : { completed: [...state.completed, taskId] },
        ),

      completeManually: (taskId) =>
        set((state) => ({
          completed: state.completed.includes(taskId)
            ? state.completed
            : [...state.completed, taskId],
          manualCompleted: state.manualCompleted.includes(taskId)
            ? state.manualCompleted
            : [...state.manualCompleted, taskId],
        })),

      toggleCompleted: (taskId) =>
        set((state) => {
          const isDone = state.completed.includes(taskId);
          return {
            completed: isDone
              ? state.completed.filter((id) => id !== taskId)
              : [...state.completed, taskId],
            manualCompleted: isDone
              ? state.manualCompleted.filter((id) => id !== taskId)
              : state.manualCompleted,
          };
        }),

      completeAll: () => set({ completed: ALL_TASK_IDS, manualCompleted: [] }),
      reset: () => set({ completed: [], manualCompleted: [], chestOpened: false }),
      openChest: () => set({ chestOpened: true }),
      setDevMode: (value) => set({ devMode: value }),
      setForceFail: (value) => set({ forceFail: value }),
    }),
    {
      name: 'thirty-progress-v1',
      partialize: (state) => ({
        completed: state.completed,
        manualCompleted: state.manualCompleted,
        chestOpened: state.chestOpened,
        devMode: state.devMode,
      }),
    },
  ),
);
