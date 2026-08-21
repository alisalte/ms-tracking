import type { ReactNode } from 'react';

/** One tab definition. */
export interface TabItem<Value extends string> {
  value: Value;
  /** Already-translated label. */
  label: ReactNode;
  /** Optional leading icon (lucide). */
  icon?: ReactNode;
  /** Optional count chip rendered after the label (e.g. row counts). */
  count?: number;
  /** Disable this tab. */
  disabled?: boolean;
}

/**
 * Tabs — TailAdmin underline tab bar (Tailwind).
 *
 * Fully controlled (`value` + `onChange`) — pages keep the active tab in state
 * (and typically in the URL, like `?tab=vehicles`). The active tab gets the
 * brand underline + bold label; counts render as subtle pills.
 */
export function Tabs<Value extends string>({
  tabs,
  value,
  onChange,
  className = '',
  'aria-label': ariaLabel,
}: {
  tabs: Array<TabItem<Value>>;
  value: Value;
  onChange: (value: Value) => void;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`flex flex-wrap items-center gap-1 border-b border-gray-200 dark:border-white/10 ${className}`}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`panel-${tab.value}`}
            id={`tab-${tab.value}`}
            disabled={tab.disabled}
            onClick={() => !active && onChange(tab.value)}
            className={`-mb-px inline-flex cursor-pointer items-center gap-2 border-b-2 border-transparent px-3.5 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              active
                ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                : 'text-gray-500 hover:border-gray-300 hover:text-gray-800 dark:text-graydark-600 dark:hover:border-white/20 dark:hover:text-graydark-800'
            }`}
          >
            {tab.icon && <span className="[&_svg]:size-4">{tab.icon}</span>}
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[0.7rem] font-semibold tabular-nums ${
                  active
                    ? 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400'
                    : 'bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-graydark-600'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
