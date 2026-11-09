import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { loadTelegramSdk } from './telegram/sdk';
import './styles/app.css';
import './styles/components.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Не найден корневой элемент #root');
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

(window as Window & { __appMounted?: boolean }).__appMounted = true;

// Асинхронно: если telegram.org недоступен, приложение всё равно работает.
loadTelegramSdk();
