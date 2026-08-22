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
          className="flex min-h-80 flex-col items-center justify-center gap-3 p-6 text-center"
        >
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            {this.props.t('errors.boundaryTitle', 'Something went wrong')}
          </h2>
          <p className="m-0 text-sm text-gray-500 dark:text-graydark-600">
            {this.props.t('errors.boundaryBody', 'The screen failed to render. You can retry.')}.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-brand-500 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
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
