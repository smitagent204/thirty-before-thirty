import { useEffect, useMemo, useState } from 'react';

export interface TelegramContext {
  available: boolean;
  userId: number | null;
  firstName: string | null;
  username: string | null;
  initData: string;
  colorScheme: 'light' | 'dark';
}

function haptic(): NonNullable<Window['Telegram']>['WebApp']['HapticFeedback'] | undefined {
  return window.Telegram?.WebApp?.HapticFeedback;
}

export function impact(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' = 'light') {
  haptic()?.impactOccurred(style);
}

export function notify(type: 'error' | 'success' | 'warning') {
  haptic()?.notificationOccurred(type);
}

/** Открывает внешнюю ссылку через Telegram, иначе — в новой вкладке браузера. */
export function openExternalLink(url: string) {
  const app = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
  if (app?.openLink) {
    app.openLink(url, { try_instant_view: false });
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function useTelegram(): TelegramContext {
  // SDK грузится асинхронно; этот счётчик перерисовывает компонент, когда он появился.
  const [sdkTick, setSdkTick] = useState(0);

  useEffect(() => {
    const bump = () => setSdkTick((value) => value + 1);
    window.addEventListener('tg-sdk-ready', bump);
    return () => window.removeEventListener('tg-sdk-ready', bump);
  }, []);

  const app = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;

  useEffect(() => {
    if (!app) return;
    app.ready();
    app.expand();
    try {
      if (app.isVersionAtLeast?.('8.0')) app.requestFullscreen?.();
      if (app.isVersionAtLeast?.('7.7')) app.disableVerticalSwipes?.();
      app.setHeaderColor?.('#140E09');
      app.setBottomBarColor?.('#140E09');
      app.setBackgroundColor?.('#0B0805');
    } catch {
      // старые клиенты Telegram — просто продолжаем без этих методов
    }
  }, [app, sdkTick]);

  return useMemo(() => {
    const user = app?.initDataUnsafe?.user;
    return {
      available: Boolean(app && app.initData),
      userId: user?.id ?? null,
      firstName: user?.first_name ?? null,
      username: user?.username ?? null,
      initData: app?.initData ?? '',
      colorScheme: app?.colorScheme ?? 'dark',
    };
  }, [app, sdkTick]);
}

/** Для демо и отладки: ?dev=1 или долгое нажатие на заголовок. */
export function isDevRequested(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('dev') === '1') return true;
    return window.localStorage.getItem('thirty-dev') === '1';
  } catch {
    return false;
  }
}
