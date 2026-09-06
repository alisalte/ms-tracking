/**
 * DateField — native date/datetime control in English; Shamsi calendar
 * popover when the UI language is Persian. Value stays Gregorian
 * `YYYY-MM-DD` / `YYYY-MM-DDTHH:mm` so APIs do not change.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
  forwardRef,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { formatDate, formatDateTime, isFaLocale } from '@/lib/format-date';
import { type JalaliDate, dateToJalali, jalaliMonthLength, jalaliToDate } from '@/lib/jalali';

type DateInputType = 'date' | 'datetime-local';

export interface DateFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className' | 'value'> {
  type?: DateInputType;
  value?: string;
  label?: ReactNode;
  error?: string | null;
  hint?: string | null;
  className?: string;
  wrapperClassName?: string;
}

const WEEKDAY_FA = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'] as const;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTES = Array.from({ length: 60 }, (_, minute) => minute);

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function parseValue(value: string | undefined, withTime: boolean): Date | null {
  if (!value) return null;
  if (withTime) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function toGregorianValue(date: Date, withTime: boolean): string {
  const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (!withTime) return ymd;
  return `${ymd}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function monthLabel(jy: number, jm: number): string {
  return formatDate(jalaliToDate(jy, jm, 1), { month: 'long', year: 'numeric' });
}

export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  {
    type = 'date',
    value = '',
    onChange,
    onBlur,
    label,
    error,
    hint,
    className = '',
    wrapperClassName = '',
    id,
    disabled,
    name,
    ...rest
  },
  ref,
) {
  const { t, i18n } = useTranslation();
  const fa = isFaLocale(i18n.language);
  const autoId = useId();
  const inputId = id ?? autoId;
  const withTime = type === 'datetime-local';
  const parsed = parseValue(value, withTime);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = parsed ? dateToJalali(parsed) : null;
  const selectedJy = selected?.jy;
  const selectedJm = selected?.jm;
  const selectedJd = selected?.jd;
  const [view, setView] = useState<JalaliDate>(() => selected ?? dateToJalali(new Date()));

  useEffect(() => {
    if (selectedJy == null || selectedJm == null || selectedJd == null) return;
    setView((prev) =>
      prev.jy === selectedJy && prev.jm === selectedJm && prev.jd === selectedJd
        ? prev
        : { jy: selectedJy, jm: selectedJm, jd: selectedJd },
    );
  }, [selectedJy, selectedJm, selectedJd]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const emit = (next: Date) => {
    const str = toGregorianValue(next, withTime);
    onChange?.({
      target: { value: str, name: name ?? '' },
      currentTarget: { value: str, name: name ?? '' },
    } as ChangeEvent<HTMLInputElement>);
  };

  const days = useMemo(() => {
    const len = jalaliMonthLength(view.jy, view.jm);
    const first = jalaliToDate(view.jy, view.jm, 1);
    // Saturday-first index (Shamsi week).
    const offset = (first.getDay() + 1) % 7;
    const cells: Array<{ jd: number | null; date: Date | null }> = [];
    for (let i = 0; i < offset; i++) cells.push({ jd: null, date: null });
    for (let jd = 1; jd <= len; jd++) {
      const hours = parsed && withTime ? parsed.getHours() : 0;
      const minutes = parsed && withTime ? parsed.getMinutes() : 0;
      cells.push({ jd, date: jalaliToDate(view.jy, view.jm, jd, hours, minutes) });
    }
    return cells;
  }, [view.jy, view.jm, parsed, withTime]);

  const shiftMonth = (delta: number) => {
    let { jy, jm } = view;
    jm += delta;
    if (jm < 1) {
      jm = 12;
      jy -= 1;
    } else if (jm > 12) {
      jm = 1;
      jy += 1;
    }
    setView({ jy, jm, jd: 1 });
  };

  const display = parsed ? (withTime ? formatDateTime(parsed) : formatDate(parsed)) : '';

  const inputClass = `h-9 w-full rounded-lg border bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-graydark-300 dark:text-white dark:placeholder:text-graydark-600 ${
    error
      ? 'border-danger-400 focus-visible:ring-danger-500'
      : 'border-gray-300 focus-visible:border-brand-500 focus-visible:ring-brand-500/30 dark:border-white/10'
  } ${className}`;

  const errorId = error ? `${inputId}-error` : undefined;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  if (!fa) {
    return (
      <div className={`flex w-full flex-col gap-1.5 ${wrapperClassName}`}>
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-gray-700 dark:text-graydark-800"
          >
            {label}
          </label>
        )}
        <input
          {...rest}
          ref={ref}
          id={inputId}
          name={name}
          type={type}
          value={value}
          disabled={disabled}
          onChange={onChange}
          onBlur={onBlur}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={inputClass}
        />
        {error ? (
          <p id={errorId} className="text-xs text-danger-600 dark:text-danger-400">
            {error}
          </p>
        ) : hint ? (
          <p id={hintId} className="text-xs text-gray-500 dark:text-graydark-600">
            {hint}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={rootRef} className={`relative flex w-full flex-col gap-1.5 ${wrapperClassName}`}>
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-gray-700 dark:text-graydark-800"
        >
          {label}
        </label>
      )}
      <input
        {...rest}
        ref={ref}
        id={inputId}
        name={name}
        type="text"
        readOnly
        disabled={disabled}
        value={display}
        placeholder={t('common.datePicker.placeholder', { defaultValue: 'انتخاب تاریخ' })}
        onBlur={onBlur}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!disabled) setOpen((v) => !v);
          }
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`${inputClass} cursor-pointer`}
      />
      {open && (
        // biome-ignore lint/a11y/useSemanticElements: popover (not a modal); native <dialog> is poorly supported in jsdom tests.
        <div
          role="dialog"
          aria-label={t('common.datePicker.title', { defaultValue: 'تقویم شمسی' })}
          className="absolute start-0 top-full z-50 mt-1 w-[272px] rounded-xl border border-gray-200 bg-white p-3 shadow-lg dark:border-white/10 dark:bg-graydark-300"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              className="inline-flex size-7 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 dark:text-graydark-700 dark:hover:bg-white/10"
              aria-label={t('common.previous')}
              onClick={() => shiftMonth(-1)}
            >
              <ChevronRight size={16} className="rtl:rotate-180" />
            </button>
            <span className="text-sm font-semibold text-gray-800 dark:text-white">
              {monthLabel(view.jy, view.jm)}
            </span>
            <button
              type="button"
              className="inline-flex size-7 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 dark:text-graydark-700 dark:hover:bg-white/10"
              aria-label={t('common.next')}
              onClick={() => shiftMonth(1)}
            >
              <ChevronLeft size={16} className="rtl:rotate-180" />
            </button>
          </div>
          <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[11px] font-medium text-gray-500 dark:text-graydark-600">
            {WEEKDAY_FA.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {days.map((cell, i) => {
              if (!cell.jd || !cell.date) {
                return <span key={`pad-${view.jy}-${view.jm}-${i}`} />;
              }
              const { jd, date } = cell;
              const isSelected =
                selected &&
                selected.jy === view.jy &&
                selected.jm === view.jm &&
                selected.jd === jd;
              const todayJ = dateToJalali(new Date());
              const isToday = todayJ.jy === view.jy && todayJ.jm === view.jm && todayJ.jd === jd;
              return (
                <button
                  key={jd}
                  type="button"
                  onClick={() => {
                    emit(date);
                    if (!withTime) setOpen(false);
                  }}
                  className={`h-8 rounded-lg text-xs tabular-nums ${
                    isSelected
                      ? 'bg-brand-500 font-semibold text-white'
                      : isToday
                        ? 'ring-1 ring-brand-400 text-gray-800 dark:text-white'
                        : 'text-gray-800 hover:bg-gray-100 dark:text-graydark-800 dark:hover:bg-white/10'
                  }`}
                >
                  {new Intl.NumberFormat('fa-IR').format(jd)}
                </button>
              );
            })}
          </div>
          {withTime && (
            <div className="mt-2 flex items-center gap-2 border-t border-gray-100 pt-2 dark:border-white/10">
              <select
                aria-label={t('common.datePicker.hour', { defaultValue: 'ساعت' })}
                className="h-8 flex-1 rounded-lg border border-gray-300 bg-white px-2 text-xs dark:border-white/10 dark:bg-graydark-200 dark:text-white"
                value={parsed ? parsed.getHours() : 0}
                onChange={(e) => {
                  const base = parsed ?? jalaliToDate(view.jy, view.jm, view.jd || 1);
                  const next = new Date(base);
                  next.setHours(Number(e.target.value));
                  emit(next);
                }}
              >
                {HOURS.map((hour) => (
                  <option key={hour} value={hour}>
                    {new Intl.NumberFormat('fa-IR', { minimumIntegerDigits: 2 }).format(hour)}
                  </option>
                ))}
              </select>
              <span className="text-gray-400">:</span>
              <select
                aria-label={t('common.datePicker.minute', { defaultValue: 'دقیقه' })}
                className="h-8 flex-1 rounded-lg border border-gray-300 bg-white px-2 text-xs dark:border-white/10 dark:bg-graydark-200 dark:text-white"
                value={parsed ? parsed.getMinutes() : 0}
                onChange={(e) => {
                  const base = parsed ?? jalaliToDate(view.jy, view.jm, view.jd || 1);
                  const next = new Date(base);
                  next.setMinutes(Number(e.target.value));
                  emit(next);
                }}
              >
                {MINUTES.map((minute) => (
                  <option key={minute} value={minute}>
                    {new Intl.NumberFormat('fa-IR', { minimumIntegerDigits: 2 }).format(minute)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="mt-2 flex justify-between">
            <button
              type="button"
              className="text-xs font-medium text-brand-600 dark:text-brand-400"
              onClick={() => {
                emit(new Date());
                if (!withTime) setOpen(false);
              }}
            >
              {t('common.datePicker.today', { defaultValue: 'امروز' })}
            </button>
            {withTime && (
              <button
                type="button"
                className="text-xs font-medium text-gray-600 dark:text-graydark-700"
                onClick={() => setOpen(false)}
              >
                {t('common.confirm', { defaultValue: 'تأیید' })}
              </button>
            )}
          </div>
        </div>
      )}
      {error ? (
        <p id={errorId} className="text-xs text-danger-600 dark:text-danger-400">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-gray-500 dark:text-graydark-600">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
