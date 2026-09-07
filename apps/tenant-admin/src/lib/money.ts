export function formatMoney(amount: number, currency = 'IRR', locale = 'fa-IR'): string {
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount || 0);
  if (currency === 'IRR') return locale.startsWith('fa') ? `${n} ریال` : `${n} IRR`;
  return `${n} ${currency}`;
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
