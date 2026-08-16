/**
 * Notification template registry (Sprint H §26/§27).
 *
 * Locale-aware title/body templates per notification event type. Templates
 * use safe {{key}} interpolation (domain/notification-template.ts) — no
 * executable code. Supported locales: en, fa (fallback: en, then the raw
 * alarm message).
 *
 * Template keys map 1:1 to the Sprint G alarm rule types — no notification
 * types exist for unsupported events (Sprint H §7).
 */
import { type TemplateData, renderTemplate } from '../../domain/notification-template.js';

export type NotificationLocale = 'en' | 'fa';

export interface LocalizedTemplate {
  readonly title: string;
  readonly body: string;
}

type TemplateEntry = Record<NotificationLocale, LocalizedTemplate>;

const TEMPLATES: Record<string, TemplateEntry> = {
  overspeed: {
    en: {
      title: 'Speeding: {{vehicleName}}',
      body: 'Vehicle {{vehicleName}} exceeded the speed limit ({{speed}} km/h in a {{speedLimit}} km/h zone).',
    },
    fa: {
      title: 'سرعت غیرمجاز: {{vehicleName}}',
      body: 'خودرو {{vehicleName}} از محدودیت سرعت عبور کرد ({{speed}} کیلومتر بر ساعت در محدوده {{speedLimit}} کیلومتر بر ساعت).',
    },
  },
  geofence_enter: {
    en: {
      title: 'Geofence entry: {{vehicleName}}',
      body: 'Vehicle {{vehicleName}} entered geofence {{geofenceName}}.',
    },
    fa: {
      title: 'ورود به حصار جغرافیایی: {{vehicleName}}',
      body: 'خودرو {{vehicleName}} وارد حصار جغرافیایی {{geofenceName}} شد.',
    },
  },
  geofence_exit: {
    en: {
      title: 'Geofence exit: {{vehicleName}}',
      body: 'Vehicle {{vehicleName}} left geofence {{geofenceName}}.',
    },
    fa: {
      title: 'خروج از حصار جغرافیایی: {{vehicleName}}',
      body: 'خودرو {{vehicleName}} از حصار جغرافیایی {{geofenceName}} خارج شد.',
    },
  },
  geofence_dwell: {
    en: {
      title: 'Geofence dwell: {{vehicleName}}',
      body: 'Vehicle {{vehicleName}} has stayed in geofence {{geofenceName}} longer than allowed.',
    },
    fa: {
      title: 'توقف طولانی در حصار جغرافیایی: {{vehicleName}}',
      body: 'خودرو {{vehicleName}} بیش از حد مجاز در حصار جغرافیایی {{geofenceName}} باقی مانده است.',
    },
  },
  device_offline: {
    en: {
      title: 'Device offline: {{vehicleName}}',
      body: 'The tracking device on vehicle {{vehicleName}} went offline.',
    },
    fa: {
      title: 'قطع ارتباط دستگاه: {{vehicleName}}',
      body: 'دستگاه ردیابی خودرو {{vehicleName}} از دسترس خارج شد.',
    },
  },
  device_online: {
    en: {
      title: 'Device online: {{vehicleName}}',
      body: 'The tracking device on vehicle {{vehicleName}} is back online.',
    },
    fa: {
      title: 'برقراری ارتباط دستگاه: {{vehicleName}}',
      body: 'دستگاه ردیابی خودرو {{vehicleName}} دوباره آنلاین شد.',
    },
  },
  prolonged_idle: {
    en: {
      title: 'Prolonged idle: {{vehicleName}}',
      body: 'Vehicle {{vehicleName}} has been idling for {{duration}}.',
    },
    fa: {
      title: 'کارکرد بیهوده طولانی: {{vehicleName}}',
      body: 'خودرو {{vehicleName}} به مدت {{duration}} در حالت کارکرد بیهوده بوده است.',
    },
  },
  parking: {
    en: {
      title: 'Unauthorized parking: {{vehicleName}}',
      body: 'Vehicle {{vehicleName}} is parked outside allowed hours or zones.',
    },
    fa: {
      title: 'پارک غیرمجاز: {{vehicleName}}',
      body: 'خودرو {{vehicleName}} خارج از ساعات یا مناطق مجاز پارک کرده است.',
    },
  },
  low_battery: {
    en: {
      title: 'Low battery: {{vehicleName}}',
      body: 'The tracking device on vehicle {{vehicleName}} reports battery at {{batteryLevel}}.',
    },
    fa: {
      title: 'باتری ضعیف: {{vehicleName}}',
      body: 'دستگاه ردیابی خودرو {{vehicleName}} میزان باتری را {{batteryLevel}} گزارش کرده است.',
    },
  },
  ignition_on: {
    en: {
      title: 'Ignition on: {{vehicleName}}',
      body: 'Vehicle {{vehicleName}} ignition turned on.',
    },
    fa: {
      title: 'روشن شدن موتور: {{vehicleName}}',
      body: 'موتور خودرو {{vehicleName}} روشن شد.',
    },
  },
  ignition_off: {
    en: {
      title: 'Ignition off: {{vehicleName}}',
      body: 'Vehicle {{vehicleName}} ignition turned off.',
    },
    fa: {
      title: 'خاموش شدن موتور: {{vehicleName}}',
      body: 'موتور خودرو {{vehicleName}} خاموش شد.',
    },
  },
  trip_started: {
    en: {
      title: 'Trip started: {{vehicleName}}',
      body: 'Vehicle {{vehicleName}} started a trip.',
    },
    fa: {
      title: 'شروع سفر: {{vehicleName}}',
      body: 'خودرو {{vehicleName}} سفر خود را آغاز کرد.',
    },
  },
  trip_ended: {
    en: {
      title: 'Trip ended: {{vehicleName}}',
      body: 'Vehicle {{vehicleName}} ended its trip.',
    },
    fa: {
      title: 'پایان سفر: {{vehicleName}}',
      body: 'خودرو {{vehicleName}} سفر خود را به پایان رساند.',
    },
  },
  excessive_trip_duration: {
    en: {
      title: 'Excessive trip duration: {{vehicleName}}',
      body: 'Vehicle {{vehicleName}} has been on a trip longer than allowed.',
    },
    fa: {
      title: 'مدت سفر غیرعادی: {{vehicleName}}',
      body: 'مدت سفر خودرو {{vehicleName}} از حد مجاز بیشتر شده است.',
    },
  },
  excessive_stop_duration: {
    en: {
      title: 'Excessive stop duration: {{vehicleName}}',
      body: 'Vehicle {{vehicleName}} has been stopped longer than allowed.',
    },
    fa: {
      title: 'توقف طولانی: {{vehicleName}}',
      body: 'خودرو {{vehicleName}} بیش از حد مجاز متوقف مانده است.',
    },
  },
};

export interface RenderedNotificationContent {
  readonly title: string;
  readonly body: string;
}

/** All event types that have a dedicated template (drives the preferences UI list). */
export function templateEventTypes(): string[] {
  return Object.keys(TEMPLATES);
}

/**
 * Render localized title/body for an event type. Falls back to English,
 * then to the provided default (the alarm message) when no template exists.
 */
export function renderNotificationContent(
  eventType: string,
  locale: NotificationLocale,
  data: TemplateData,
  fallback?: { title: string; body: string },
): RenderedNotificationContent {
  const entry = TEMPLATES[eventType];
  if (!entry) {
    return (
      fallback ?? {
        title: `Notification: ${eventType.replace(/_/g, ' ')}`,
        body: '',
      }
    );
  }
  const template = entry[locale] ?? entry.en;
  return {
    title: renderTemplate(template.title, data),
    body: renderTemplate(template.body, data),
  };
}
