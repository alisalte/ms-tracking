/**
 * ErrorBoundary — last-resort render crash containment (Sprint E §22).
 *
 * Wraps the routed app so an unexpected render error shows a recoverable
 * error screen instead of a blank page. API errors are NOT handled here —
 * they flow through the typed ApiClientError hierarchy into per-page error
 * states; this boundary only catches genuine render-time exceptions.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { withTranslation } from 'react-i18next';

interface Props {
  children: ReactNode;
  /** Render override (tests / embedded use). */
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

class ErrorBoundaryImpl extends Component<Props & { t: (k: string, d?: string) => string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Structured, no payload data — matches the backend logging convention.
    console.error('[ErrorBoundary]', error.message, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback !== undefined) return this.props.fallback;
      return (
        <div
          role="alert"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            minHeight: 320,
            padding: 24,
            textAlign: 'center',
          }}
        >
          <h2 style={{ margin: 0 }}>
            {this.props.t('errors.boundaryTitle', 'Something went wrong')}
          </h2>
          <p style={{ margin: 0, opacity: 0.7 }}>
            {this.props.t('errors.boundaryBody', 'The screen failed to render. You can retry.')}.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ padding: '8px 20px', cursor: 'pointer' }}
          >
            {this.props.t('errors.reload', 'Reload')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export const ErrorBoundary = withTranslation()(ErrorBoundaryImpl);
