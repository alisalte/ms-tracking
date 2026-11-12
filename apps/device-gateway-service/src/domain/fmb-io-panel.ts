/**
 * Live I/O panel of a Teltonika FMB640 (inputs, outputs, 1-Wire, serial and
 * bus sensors). Built by the Teltonika adapter, merged across records by
 * `FmbIoStore`, shipped as `telemetry.fmbIo` and rendered by the dashboard.
 */
export type FmbIoGroup =
  | 'din'
  | 'dout'
  | 'ain'
  | 'onewire'
  | 'serial'
  | 'can'
  | 'j1708'
  | 'kline'
  | 'other';

export interface FmbIoPoint {
  /** AVL IO id as sent by the device. */
  readonly id: number;
  /** i18n key suffix; null for an element the catalog does not know. */
  readonly key: string | null;
  readonly group: FmbIoGroup;
  readonly value: number | boolean | string;
  readonly unit?: string;
  /** Device time of the record that last reported this element (ISO). */
  readonly at: string;
}

export interface FmbIoPanel {
  /** Device time of the newest point (ISO). */
  readonly updatedAt: string;
  readonly groups: Partial<Record<FmbIoGroup, readonly FmbIoPoint[]>>;
}
