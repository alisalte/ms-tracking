import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';

/**
 * Table — TailAdmin table primitives (Tailwind).
 *
 * Small composition kit (`Table` + `THead/TBody/TFoot` + `TR/TH/TD`) styled to
 * the TailAdmin dense-ops look. The legacy MUI `ui/DataTable` API ports onto
 * this kit in Phase 3; these primitives are the building blocks.
 */

export interface TableProps {
  children: ReactNode;
  className?: string;
  /** Table caption (announced by screen readers; visually hidden). */
  caption?: ReactNode;
}

export function Table({ children, className = '', caption }: TableProps) {
  return (
    <div className="fv-scroll w-full overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-white/10 dark:bg-graydark-300">
      <table className={`w-full border-collapse text-sm ${className}`}>
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="bg-gray-50 text-gray-500 dark:bg-graydark-200 dark:text-graydark-600">
      {children}
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-gray-100 dark:divide-white/5">{children}</tbody>;
}

export function TFoot({ children }: { children: ReactNode }) {
  return (
    <tfoot className="border-t border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-graydark-200">
      {children}
    </tfoot>
  );
}

export interface THProps extends Omit<ThHTMLAttributes<HTMLTableCellElement>, 'align'> {
  children?: ReactNode;
  /** Align the header cell (logical start/end for RTL). */
  align?: 'start' | 'end' | 'center';
}

export function TH({ children, align = 'start', className = '', ...rest }: THProps) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-4 py-3 text-start text-xs font-semibold tracking-wide uppercase ${
        align === 'end' ? 'text-end' : align === 'center' ? 'text-center' : 'text-start'
      } ${className}`}
      {...rest}
    >
      {children}
    </th>
  );
}

export interface TDProps extends Omit<TdHTMLAttributes<HTMLTableCellElement>, 'align'> {
  children?: ReactNode;
  align?: 'start' | 'end' | 'center';
}

export function TD({ children, align = 'start', className = '', ...rest }: TDProps) {
  return (
    <td
      className={`px-4 py-3 text-gray-700 dark:text-graydark-800 ${
        align === 'end' ? 'text-end' : align === 'center' ? 'text-center' : 'text-start'
      } ${className}`}
      {...rest}
    >
      {children}
    </td>
  );
}
