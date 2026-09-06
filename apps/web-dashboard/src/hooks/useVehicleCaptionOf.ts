import { useMemo } from 'react';

import { useVehicles } from '@/api/asset.api';
import { isUuid } from '@/lib/ids';
import { formatVehicleLabel } from '@/lib/vehicle-label';

/** Resolve a vehicle id to name · plate; never returns a raw GUID. */
export function useVehicleCaptionOf(): (id: string | undefined) => string {
  const { data: vehicles } = useVehicles();
  return useMemo(() => {
    const labels = new Map((vehicles ?? []).map((v) => [v.id, formatVehicleLabel(v)] as const));
    return (id: string | undefined) => {
      if (!id) return '';
      const caption = labels.get(id)?.trim() ?? '';
      return caption && !isUuid(caption) ? caption : '';
    };
  }, [vehicles]);
}
