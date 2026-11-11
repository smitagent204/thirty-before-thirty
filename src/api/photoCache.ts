import { api, type PhotoResult } from './client';

/**
 * Фото задания за одно открытое приложение запрашивается один раз.
 *
 * Раньше и шторка, и аллея тянули `/api/tasks/:id/photo` самостоятельно, а кэш
 * аллеи жил только пока она открыта. Теперь кэш общий на всё приложение: после
 * первого запроса фото остаётся в памяти, пока вкладка не закрыта.
 */
const resolved = new Map<string, PhotoResult>();
const inFlight = new Map<string, Promise<PhotoResult>>();
/** Версия задания: ответ, начатый до сброса кэша, не должен его перезаписать. */
const versions = new Map<string, number>();

/** Загрузить фото задания (или взять уже загруженное из памяти). */
export function loadPhoto(taskId: string): Promise<PhotoResult> {
  const ready = resolved.get(taskId);
  if (ready) return Promise.resolve(ready);

  const pending = inFlight.get(taskId);
  if (pending) return pending;

  const version = versions.get(taskId) ?? 0;
  const request = api.photo(taskId).then(
    (photo) => {
      if ((versions.get(taskId) ?? 0) === version) resolved.set(taskId, photo);
      return photo;
    },
    (error: unknown) => {
      // Упавший запрос не должен блокировать повторную попытку.
      if ((versions.get(taskId) ?? 0) === version) inFlight.delete(taskId);
      throw error;
    },
  );

  inFlight.set(taskId, request);
  return request;
}

/** Сбросить кэш задания: после новой загрузки, апелляции или ручного сброса. */
export function invalidatePhoto(taskId: string): void {
  versions.set(taskId, (versions.get(taskId) ?? 0) + 1);
  inFlight.delete(taskId);
  resolved.delete(taskId);
}

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
};

/** Сколько фотографий тянем одновременно в фоне. */
const WARM_CONCURRENCY = 2;

/**
 * Фоновая догрузка фото выполненных заданий. Запускается после первого кадра,
 * чтобы не соревноваться с отрисовкой, и тянет по два кадра за раз.
 */
export function warmPhotos(taskIds: string[]): void {
  const queue = taskIds.filter((id) => !resolved.has(id) && !inFlight.has(id));
  if (queue.length === 0) return;

  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < queue.length) {
      const taskId = queue[cursor++];
      try {
        await loadPhoto(taskId);
      } catch {
        // Фото нет (например, задание засчитано вручную) — пропускаем.
      }
    }
  };

  const start = () => {
    void Promise.all(
      Array.from({ length: Math.min(WARM_CONCURRENCY, queue.length) }, worker),
    );
  };

  const idleWindow = window as IdleWindow;
  if (typeof idleWindow.requestIdleCallback === 'function') {
    idleWindow.requestIdleCallback(start, { timeout: 2000 });
  } else {
    window.setTimeout(start, 350);
  }
}
