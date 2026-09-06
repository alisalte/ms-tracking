import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DateField } from '@/components/tailwind-ui/DateField';
import { i18n } from '@/i18n';
import { formatDate, formatDateTime, isFaLocale } from '@/lib/format-date';
import { dateToJalali, jalaliMonthLength, jalaliToDate } from '@/lib/jalali';

describe('jalali conversion', () => {
  it('maps 6 Sep 2026 to 15 Shahrivar 1405', () => {
    expect(dateToJalali(new Date(2026, 8, 6))).toEqual({ jy: 1405, jm: 6, jd: 15 });
  });

  it('round-trips a mid-year date', () => {
    const d = jalaliToDate(1405, 6, 15);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(6);
  });

  it('gives Esfand 29 or 30 days', () => {
    const len = jalaliMonthLength(1405, 12);
    expect(len === 29 || len === 30).toBe(true);
  });
});

describe('formatDate', () => {
  it('uses Gregorian English in en', () => {
    const text = formatDate(
      new Date(2026, 8, 6),
      { year: 'numeric', month: 'short', day: 'numeric' },
      'en',
    );
    expect(text).toMatch(/Sep/i);
    expect(text).toMatch(/2026/);
  });

  it('uses Solar Hijri in fa', () => {
    const text = formatDate(new Date(2026, 8, 6), undefined, 'fa');
    expect(text).toMatch(/۱۴۰۵|1405/);
    expect(text).not.toMatch(/2026/);
  });

  it('formatDateTime in fa includes a Shamsi year', () => {
    const text = formatDateTime(new Date(2026, 8, 6, 12, 30), undefined, 'fa');
    expect(text).toMatch(/۱۴۰۵|1405/);
  });

  it('detects fa locale', () => {
    expect(isFaLocale('fa')).toBe(true);
    expect(isFaLocale('fa-IR')).toBe(true);
    expect(isFaLocale('en')).toBe(false);
  });
});

describe('DateField Shamsi picker', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('fa');
  });
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('opens a Shamsi calendar instead of a native date input', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <DateField type="date" value="2026-09-06" aria-label="تاریخ" onChange={() => undefined} />
      </I18nextProvider>,
    );
    expect(screen.queryByDisplayValue('2026-09-06')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('تاریخ'));
    expect(screen.getByRole('dialog', { name: /تقویم شمسی/ })).toBeInTheDocument();
    expect(screen.getByText('۱۵')).toBeInTheDocument();
  });
});
