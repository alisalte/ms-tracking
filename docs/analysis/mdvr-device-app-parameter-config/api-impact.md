# API impact

## Reuse

- `GET /device-commands/catalog`
- `POST` send command (existing fleet-management / devices commands path used by Command Center)
- Command history polling

## Add (thin)

- `GET /device-commands/parameter/alarm-events` — static/localized event list for UI (or ship catalog in frontend from shared package)
- Optional: `POST /devices/:id/parameter/alarm-link` — **server-side composer** that expands Link Sett DTO → multiple Meitrack commands (preferred over pure client fan-out for audit + ordering)

Recommended: **server composer** so ACK aggregation and authorization stay server-side.
