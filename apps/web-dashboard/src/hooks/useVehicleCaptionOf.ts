import { useMemo } from 'react';

import { useDevices, useVehicles } from '@/api/asset.api';
import { isUuid } from '@/lib/ids';
import { formatVehicleLabel } from '@/lib/vehicle-label';

/**
 * Resolve a vehicle (or device) id to a human caption — name · plate, else IMEI.
 * Device-status alarms often put the device UUID in `vehicleId`.
 */
export function useVehicleCaptionOf(): (id: string | undefined) => string {
  const { data: vehicles } = useVehicles();
  const { data: devices } = useDevices();
  return useMemo(() => {
    const labels = new Map((vehicles ?? []).map((v) => [v.id, formatVehicleLabel(v)] as const));
    const deviceToVehicle = new Map<string, string>();
    const deviceImei = new Map<string, string>();
    for (const d of devices ?? []) {
      if (d.vehicleId) deviceToVehicle.set(d.id, d.vehicleId);
      if (d.imei?.trim()) deviceImei.set(d.id, d.imei.trim());
    }
    return (id: string | undefined) => {
      if (!id) return '';
      const direct = labels.get(id)?.trim() ?? '';
      if (direct && !isUuid(direct)) return direct;
      const viaDevice = deviceToVehicle.get(id);
      if (viaDevice) {
        const bound = labels.get(viaDevice)?.trim() ?? '';
        if (bound && !isUuid(bound)) return bound;
      }
      const imei = deviceImei.get(id);
      return imei ? `IMEI ${imei}` : '';
    };
  }, [vehicles, devices]);
}
