/**
 * Jalali (Solar Hijri) ↔ Gregorian conversion for date pickers.
 *
 * Compact form of the well-known jalaali algorithm (same results as ICU
 * `calendar: 'persian'` for civil dates). Operates on local calendar Y/M/D.
 */
export interface JalaliDate {
  readonly jy: number;
  readonly jm: number;
  readonly jd: number;
}

export function gregorianToJalali(gy: number, gm: number, gd: number): JalaliDate {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  const gy2 = gy - (gy <= 1600 ? 621 : 1600);
  const gyLeap = gm > 2 ? gy2 + 1 : gy2;
  let days =
    365 * gy2 +
    Math.floor((gyLeap + 3) / 4) -
    Math.floor((gyLeap + 99) / 100) +
    Math.floor((gyLeap + 399) / 400) -
    80 +
    gd +
    (g_d_m[gm - 1] ?? 0);
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { jy, jm, jd };
}

export function jalaliToGregorian(
  jy: number,
  jm: number,
  jd: number,
): { gy: number; gm: number; gd: number } {
  let gy = jy <= 979 ? 621 : 1600;
  const jyNorm = jy <= 979 ? jy : jy - 979;
  const days =
    365 * jyNorm +
    Math.floor(jyNorm / 33) * 8 +
    Math.floor(((jyNorm % 33) + 3) / 4) +
    78 +
    jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  gy += 400 * Math.floor(days / 146097);
  let rem = days % 146097;
  if (rem > 36524) {
    gy += 100 * Math.floor(--rem / 36524);
    rem %= 36524;
    if (rem >= 365) rem++;
  }
  gy += 4 * Math.floor(rem / 1461);
  rem %= 1461;
  if (rem > 365) {
    gy += Math.floor((rem - 1) / 365);
    rem = (rem - 1) % 365;
  }
  let gd = rem + 1;
  const sal_a = [
    0,
    31,
    (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  let gm = 0;
  for (; gm < 13 && gd > (sal_a[gm] ?? 0); gm++) gd -= sal_a[gm] ?? 0;
  return { gy, gm, gd };
}

export function dateToJalali(date: Date): JalaliDate {
  return gregorianToJalali(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** Local midnight of a Jalali civil date. */
export function jalaliToDate(jy: number, jm: number, jd: number, hours = 0, minutes = 0): Date {
  const { gy, gm, gd } = jalaliToGregorian(jy, jm, jd);
  return new Date(gy, gm - 1, gd, hours, minutes, 0, 0);
}

export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  const thisYear = jalaliToGregorian(jy, 12, 30);
  const nextYear = jalaliToGregorian(jy + 1, 1, 1);
  const a = Date.UTC(thisYear.gy, thisYear.gm - 1, thisYear.gd);
  const b = Date.UTC(nextYear.gy, nextYear.gm - 1, nextYear.gd);
  return Math.round((b - a) / 86_400_000) >= 1 ? 30 : 29;
}
