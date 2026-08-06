/**
 * Engine-Hours meter — accumulates engine-on time (07 §5.6).
 *
 * Engine hours accrue while the ignition is ON (regardless of movement — idle
 * counts). On ignition-OFF, the accumulated window is flushed (emitted). The
 * accumulator is driven by the Δt between consecutive positions while ignition
 * is on.
 *
 * Pure: takes the accumulated seconds + prev/current positions, returns the new
 * total + a flush value when ignition turns off.
 */
import type { PositionEvent } from '../../domain/position-event.js';

export interface EngineHoursInput {
  /** Accumulated engine-on seconds so far. */
  readonly accumulatedSec: number;
  readonly prevPosition: PositionEvent | null;
  readonly position: PositionEvent;
}

export interface EngineHoursOutput {
  /** New accumulated engine-on seconds. */
  readonly accumulatedSec: number;
  /**
   * The total accumulated seconds at the moment ignition turned off (a flush
   * trigger), or null if ignition is still on / was already off.
   */
  readonly flushed: number | null;
}

/** Advance the engine-hours accumulator by one position. Pure. */
export function advanceEngineHours(input: EngineHoursInput): EngineHoursOutput {
  const { accumulatedSec, prevPosition, position } = input;
  const ignitionOn = position.ignitionOn === true;
  const prevIgnitionOn = prevPosition?.ignitionOn === true;

  if (!prevPosition) {
    // First sighting — no Δt to accumulate.
    return { accumulatedSec: ignitionOn ? 0 : accumulatedSec, flushed: null };
  }

  const dtSec = Math.max(
    (position.capturedAt.getTime() - prevPosition.capturedAt.getTime()) / 1000,
    0,
  );

  // Both on → accumulate Δt.
  if (ignitionOn && prevIgnitionOn) {
    return { accumulatedSec: accumulatedSec + dtSec, flushed: null };
  }

  // Ignition turned off this step → flush the accumulated window.
  if (!ignitionOn && prevIgnitionOn) {
    // Add the final partial Δt before the edge, then flush.
    const total = accumulatedSec + dtSec;
    return { accumulatedSec: 0, flushed: total > 0 ? total : null };
  }

  // Ignition off throughout, or turning on — no accrual.
  return { accumulatedSec: ignitionOn ? 0 : accumulatedSec, flushed: null };
}
