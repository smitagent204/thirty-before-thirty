import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[30до30] Ошибка рендера:', error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          maxWidth: 520,
          margin: '48px auto',
          padding: 20,
          border: '1px solid #6b4212',
          borderRadius: 14,
          background: '#241812',
          color: '#f7eedd',
          fontFamily: 'system-ui, sans-serif',
          lineHeight: 1.5,
        }}
      >
        <strong>Приложение упало при отрисовке</strong>
        <p style={{ color: '#c9b79a', fontSize: 14 }}>
          Перезагрузи страницу. Если ошибка повторяется — пришли текст ниже.
        </p>
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: '#ff9b9b',
            fontSize: 12,
            margin: '12px 0 16px',
          }}
        >
          {error.message}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            minHeight: 44,
            padding: '0 18px',
            border: '1px solid #6b4212',
            borderRadius: 10,
            background: '#ffd75e',
            color: '#2a1a0e',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Перезагрузить
        </button>
      </div>
    );
  }
}
