/** Format seconds as whole hours for KPI display. */
export function hoursFromSec(sec: number): number {
  return Math.round(sec / 3600);
}
