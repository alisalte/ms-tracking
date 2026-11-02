/**
 * CSV localization — machine keys and codes (the API/download contract) mapped
 * to Persian for human-facing files such as scheduled report emails.
 */

export type CsvLocale = 'en' | 'fa';

const FA_HEADERS: Readonly<Record<string, string>> = {
  vehicle: 'خودرو',
  driver: 'راننده',
  route: 'مسیر',
  shovel: 'شافل',
  type: 'نوع',
  severity: 'شدت',
  total: 'تعداد کل',
  open: 'باز',
  acknowledged: 'تأییدشده',
  resolved: 'حل‌شده',
  trips: 'تعداد سفر',
  episode: 'رویداد',
  date_shamsi: 'تاریخ',
  time: 'ساعت',
  start_date_shamsi: 'تاریخ شروع',
  start_time: 'ساعت شروع',
  end_date_shamsi: 'تاریخ پایان',
  end_time: 'ساعت پایان',
  period_start_date_shamsi: 'تاریخ شروع بازه',
  period_start_time: 'ساعت شروع بازه',
  period_end_date_shamsi: 'تاریخ پایان بازه',
  period_end_time: 'ساعت پایان بازه',
  duration_s: 'مدت (ثانیه)',
  duration_sec: 'مدت (ثانیه)',
  distance_km: 'مسافت (کیلومتر)',
  avg_speed_kph: 'میانگین سرعت (کیلومتر بر ساعت)',
  max_speed_kph: 'بیشینهٔ سرعت (کیلومتر بر ساعت)',
  speed_kph: 'سرعت (کیلومتر بر ساعت)',
  limit_kph: 'حد مجاز (کیلومتر بر ساعت)',
  over_limit_kph: 'مازاد بر حد مجاز (کیلومتر بر ساعت)',
  lat: 'عرض جغرافیایی',
  lng: 'طول جغرافیایی',
  system_alarm: 'هشدار سیستمی',
  episode_max_speed_kph: 'بیشینهٔ سرعت رویداد (کیلومتر بر ساعت)',
  episode_duration_s: 'مدت رویداد (ثانیه)',
  moving_s: 'حرکت (ثانیه)',
  idle_s: 'درجا (ثانیه)',
  parking_s: 'پارک (ثانیه)',
  observed_s: 'پوشش (ثانیه)',
  utilization_pct: 'بهره‌وری (درصد)',
  shift_date: 'تاریخ شیفت',
  shift_no: 'شماره شیفت',
  origin_entered_date_shamsi: 'تاریخ ورود به مبدأ',
  origin_entered_time: 'ساعت ورود به مبدأ',
  origin_left_date_shamsi: 'تاریخ خروج از مبدأ',
  origin_left_time: 'ساعت خروج از مبدأ',
  destination_entered_date_shamsi: 'تاریخ ورود به مقصد',
  destination_entered_time: 'ساعت ورود به مقصد',
  load_dwell_sec: 'توقف در مبدأ (ثانیه)',
  travel_sec: 'حمل (ثانیه)',
};

/** Localize header keys; unknown keys pass through unchanged. */
export function localizeCsvHeader(header: readonly string[], locale: CsvLocale = 'en'): string[] {
  if (locale === 'en') return [...header];
  return header.map((key) => FA_HEADERS[key] ?? key);
}

const FA_SEVERITIES: Readonly<Record<string, string>> = {
  INFO: 'اطلاعات',
  LOW: 'کم',
  MEDIUM: 'متوسط',
  HIGH: 'زیاد',
  CRITICAL: 'بحرانی',
};

/** Rule types (lower-case in the engine) and device codes, keyed upper-case. */
const FA_ALARM_TYPES: Readonly<Record<string, string>> = {
  OVERSPEED: 'سرعت غیرمجاز',
  IGNITION_ON: 'روشن شدن موتور',
  IGNITION_OFF: 'خاموش شدن موتور',
  PROLONGED_IDLE: 'درجا طولانی',
  PARKING: 'پارک',
  DEVICE_OFFLINE: 'ارتباط با دستگاه قطع شد',
  DEVICE_ONLINE: 'ارتباط با دستگاه برقرار شد',
  LOW_BATTERY: 'باتری ردیاب ضعیف است',
  LOW_POWER: 'ولتاژ باتری خودرو پایین است',
  GEOFENCE_ENTER: 'ورود به محدوده',
  GEOFENCE_EXIT: 'خروج از محدوده',
  GEOFENCE_DWELL: 'توقف در محدوده',
  TRIP_STARTED: 'شروع سفر',
  TRIP_ENDED: 'پایان سفر',
  EXCESSIVE_TRIP_DURATION: 'مدت سفر بیش از حد',
  EXCESSIVE_STOP_DURATION: 'توقف بیش از حد',
  SOS: 'درخواست کمک اضطراری (SOS)',
  POWER_CUT: 'برق ردیاب قطع شد',
  POWER_RESTORED: 'برق ردیاب دوباره وصل شد',
  GPS_SIGNAL_LOST: 'سیگنال ماهواره (GPS) قطع شد',
  GPS_RECOVERED: 'سیگنال GPS برگشت',
  TOW: 'یدک‌کشی / حرکت غیرمجاز',
  JAMMING: 'اختلال عمدی در سیگنال (جمینگ)',
  TEMPERATURE_HIGH: 'دمای بالا',
  TEMPERATURE_LOW: 'دمای پایین',
  FUEL_LOW: 'سوخت کم',
  FUEL_THEFT: 'سرقت سوخت',
  FUEL_FILLING: 'سوخت‌گیری',
  ACCIDENT: 'تصادف',
  COLLISION: 'تصادف',
  ROLLOVER: 'واژگونی',
  CORNERING: 'پیچیدن تند',
  BRAKING: 'ترمز شدید',
  ACCELERATION: 'شتاب شدید',
  DRIVING_BEHAVIOR: 'رانندگی پرخطر',
  FATIGUE_DRIVING: 'خستگی راننده',
  FATIGUE_TIME: 'رانندگی طولانی بدون استراحت',
  ADAS_DMS_ALARM: 'هشدار دوربین کمک‌راننده',
  FACE_ID_ALARM: 'هشدار تشخیص چهره',
  IDLE_OVERTIME: 'درجا کار کردن طولانی',
  MAINTENANCE_NOTICE: 'زمان سرویس',
  TPMS_ALARM: 'هشدار فشار باد تایر',
  DEVICE_REBOOT: 'دستگاه راه‌اندازی مجدد شد',
};

function codeKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[-\s]+/g, '_');
}

/** Alarm severity code → label; unknown codes pass through unchanged. */
export function localizeSeverity(value: string, locale: CsvLocale = 'en'): string {
  if (locale === 'en') return value;
  return FA_SEVERITIES[codeKey(value)] ?? value;
}

/** Alarm type (rule type or device code) → label; unknown codes pass through unchanged. */
export function localizeAlarmType(value: string, locale: CsvLocale = 'en'): string {
  if (locale === 'en') return value;
  return FA_ALARM_TYPES[codeKey(value)] ?? value;
}

export function localizeYesNo(value: boolean, locale: CsvLocale = 'en'): string {
  if (locale === 'fa') return value ? 'بله' : 'خیر';
  return value ? 'yes' : 'no';
}
