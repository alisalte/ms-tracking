# Database impact

## Phase 1

- **None required** if UI only composes live commands + history.

## Phase 1.1 (recommended)

- Optional `fleet.device_parameter_snapshots` or Redis cache: `{ deviceId, section, payload, updatedAt, source: 'readback'|'set' }` for faster Refresh UX.

## Not in Phase 1

- Syncing Parameter Alarm into `notification.alerts` rules tables.
