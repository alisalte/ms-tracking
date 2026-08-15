/** Fleet domain types (Sprint C §6). */

/** Fleet lifecycle status. DELETE = ARCHIVE (soft), never a hard delete (§27). */
export type FleetStatus = 'ACTIVE' | 'ARCHIVED';

export interface FleetRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly code: string;
  readonly description: string | null;
  readonly status: FleetStatus;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
