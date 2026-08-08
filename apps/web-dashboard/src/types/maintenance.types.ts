/**
 * CMMS (Maintenance) domain types — typed contract.
 *
 * TODO: No maintenance-service exists yet. These types define the contract for
 * when the backend lands CMMS endpoints.
 *
 * Source: docs/modules/CMMS.md.
 */

/** Work order status (CMMS §3 WorkOrder). */
export type WorkOrderStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

/** Work order priority. */
export type WorkOrderPriority = 'low' | 'medium' | 'high' | 'urgent';

/** Work order type. */
export type WorkOrderType = 'corrective' | 'preventive' | 'inspection' | 'project';

/** A maintenance work order (CMMS §3, UI subset). */
export interface WorkOrder {
  id: string;
  title: string;
  description: string;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  type: WorkOrderType;
  vehicleId: string;
  vehicleLabel: string;
  assignedTo?: string;
  /** Estimated cost in cents. */
  estimatedCostCents?: number;
  /** Actual cost in cents. */
  actualCostCents?: number;
  createdAt: string;
  completedAt?: string;
  dueDate?: string;
}

/** Preventive maintenance schedule (CMMS §4). */
export interface PMSchedule {
  id: string;
  name: string;
  vehicleId: string;
  vehicleLabel: string;
  /** Trigger type: interval-based or meter-based. */
  triggerType: 'time' | 'odometer' | 'engine_hours';
  /** Interval value (days, km, or hours depending on triggerType). */
  intervalValue: number;
  /** Last executed date. */
  lastExecutedAt?: string;
  /** Next due date. */
  nextDueAt?: string;
  enabled: boolean;
}
