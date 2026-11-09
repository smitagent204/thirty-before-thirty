/**
 * Загружаем официальный telegram-web-app.js асинхронно, чтобы недоступный
 * telegram.org не блокировал первую отрисовку приложения.
 */
let requested = false;

export function loadTelegramSdk(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.Telegram?.WebApp || requested) return;
  requested = true;

  const script = document.createElement('script');
  script.src = 'https://telegram.org/js/telegram-web-app.js';
  script.async = true;
  script.onload = () => {
    window.dispatchEvent(new Event('tg-sdk-ready'));
  };
  script.onerror = () => {
    // Работаем без Telegram SDK: приложение остаётся доступным в браузере.
    console.warn('[30до30] Не удалось загрузить telegram-web-app.js');
  };
  document.head.appendChild(script);
}
