export function formatMoney(amount: number, currency = 'IRR', locale = 'fa-IR'): string {
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount || 0);
  if (currency === 'IRR') return locale.startsWith('fa') ? `${n} ریال` : `${n} IRR`;
  return `${n} ${currency}`;
}

export function formatCompactNumber(amount: number, locale = 'fa-IR'): string {
  const loc = locale.startsWith('fa') ? 'fa-IR' : 'en-GB';
  const fa = locale.startsWith('fa');
  const abs = Math.abs(amount);
  const fmt = (n: number) =>
    new Intl.NumberFormat(loc, { maximumFractionDigits: Math.abs(n) >= 10 ? 0 : 1 }).format(n);

  if (abs >= 1_000_000_000)
    return fa ? `${fmt(amount / 1_000_000_000)} میلیارد` : `${fmt(amount / 1_000_000_000)}B`;
  if (abs >= 1_000_000)
    return fa ? `${fmt(amount / 1_000_000)} میلیون` : `${fmt(amount / 1_000_000)}M`;
  if (abs >= 1_000) return fa ? `${fmt(amount / 1_000)} هزار` : `${fmt(amount / 1_000)}k`;
  return new Intl.NumberFormat(loc, { maximumFractionDigits: 0 }).format(amount || 0);
}

export function estimateTotal(input: {
  basePrice: number;
  maxUsers: number;
  unitPriceUsers: number;
  maxVehicles: number;
  unitPriceVehicles: number;
  maxDevices: number;
  unitPriceDevices: number;
  maxDrivers: number;
  unitPriceDrivers: number;
  storageGib: number;
  unitPriceStorageGib: number;
  downloadGib: number;
  unitPriceDownloadGib: number;
}): number {
  return Math.round(
    input.basePrice +
      input.maxUsers * input.unitPriceUsers +
      input.maxVehicles * input.unitPriceVehicles +
      input.maxDevices * input.unitPriceDevices +
      input.maxDrivers * input.unitPriceDrivers +
      input.storageGib * input.unitPriceStorageGib +
      input.downloadGib * input.unitPriceDownloadGib,
  );
}
