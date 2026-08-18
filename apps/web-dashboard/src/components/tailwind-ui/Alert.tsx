import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Alert — TailAdmin inline message banner (Tailwind).
 *
 * Tonal light/dark variants for the four semantic levels. `role` is `alert`
 * for warning/danger (assertive) and `status` otherwise (polite).
 */
export type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

export interface AlertProps {
  variant?: AlertVariant;
  /** Bold lead-in line rendered above the body. */
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  onClose?: () => void;
  className?: string;
}

const VARIANTS: Record<AlertVariant, { wrap: string; icon: string; defaultIcon: ReactNode }> = {
  info: {
    wrap: 'bg-info-50 text-info-700 border-info-100 dark:bg-info-500/10 dark:text-info-400 dark:border-info-500/20',
    icon: 'text-info-500',
    defaultIcon: <Info size={18} />,
  },
  success: {
    wrap: 'bg-success-50 text-success-700 border-success-100 dark:bg-success-500/10 dark:text-success-400 dark:border-success-500/20',
    icon: 'text-success-500',
    defaultIcon: <CheckCircle2 size={18} />,
  },
  warning: {
    wrap: 'bg-warning-50 text-warning-700 border-warning-100 dark:bg-warning-500/10 dark:text-warning-400 dark:border-warning-500/20',
    icon: 'text-warning-500',
    defaultIcon: <TriangleAlert size={18} />,
  },
  danger: {
    wrap: 'bg-danger-50 text-danger-700 border-danger-100 dark:bg-danger-500/10 dark:text-danger-400 dark:border-danger-500/20',
    icon: 'text-danger-500',
    defaultIcon: <AlertCircle size={18} />,
  },
};

export function Alert({
  variant = 'info',
  title,
  children,
  icon,
  onClose,
  className = '',
}: AlertProps) {
  const v = VARIANTS[variant];
  return (
    <div
      role={variant === 'warning' || variant === 'danger' ? 'alert' : 'status'}
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${v.wrap} ${className}`}
    >
      <span className={`mt-0.5 shrink-0 ${v.icon}`}>{icon ?? v.defaultIcon}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="shrink-0 rounded-md p-0.5 opacity-60 transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-current"
        >
          <X size={16} aria-hidden />
        </button>
      )}
    </div>
  );
}
