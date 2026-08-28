/**
 * Shared vehicle caption: name and plate together, never plate-only when a
 * name exists. Used by the map, trips, geofences, and any registry join.
 */
export interface VehicleCaptionParts {
  name?: string | null;
  plate?: string | null;
  code?: string | null;
}

/** `"Name · Plate"` when both exist and differ; otherwise the first available. */
export function formatVehicleLabel(v: VehicleCaptionParts): string {
  const name = v.name?.trim() ?? '';
  const plate = v.plate?.trim() ?? '';
  if (name && plate && name !== plate) return `${name} · ${plate}`;
  return name || plate || v.code?.trim() || '';
}
