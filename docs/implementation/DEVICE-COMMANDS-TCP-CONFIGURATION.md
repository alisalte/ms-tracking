# Device Commands — TCP Device Configuration (Meitrack MDVR)

Full downstream command path: **UI → fleet-management → Kafka → device-gateway → device TCP socket**, closing the documented P2 gap "Device command dispatch — MISSING" (PROJECT_STATUS_REPORT §31/§961) and replacing the CommandCenterPage placeholder.

Command surface: **every TCP-settable command of the Meitrack MDVR GPRS Protocol V2.0 (2024-03-20)** — 74 catalog entries across 14 categories, plus a raw-text escape hatch.

## Flow

```
CommandCenterPage (/commands)
  → POST /api/v1/devices/:id/commands { commandCode, params, ttlSec? }
    fleet-management: device checks (ACTIVE + protocol=meitrack)
      → catalog validation (validateParams) → payload build (text | hex struct)
      → INSERT fleet.device_commands (QUEUED) + audit
      → Kafka fleetvision.telemetry.command.request
  → device-gateway CommandRequestConsumer (per-instance group = broadcast;
    only the session owner writes — 06 §6.2 "route to owning instance")
    → SessionManager.byDeviceId → canDispatchCommand() gate (06 §6.1 #2)
    → adapter.encode → SessionWriter (socket.write)
    → publish telemetry.command.sent.v1 | telemetry.command.rejected.v1
  → device replies $$..,A11,OK (echoed code — MDVR V2.0 §3.x)
    → gateway decodes COMMAND_ACK → telemetry.command.ack topic
  → fleet-management CommandAckConsumer
    → match latest QUEUED/SENT row by (tenant, device, code)
    → ACKED (response OK) / FAILED (error payload)
  → TTL sweeper expires unacked rows (EXPIRED)
  → UI polls history (3s while in-flight)
```

## Command catalog (fleet-management)

`src/domain/device-command/meitrack-command-catalog.ts` — single source of truth, served to the UI at `GET /api/v1/device-commands/catalog` (dynamic forms; bilingual labels embedded).

| Category | Commands |
|---|---|
| tracking | A10 A11 A12 A13 A14 A15 A16 A17 |
| network | A21 A23 A25 ABB AA3 |
| phone | A70 A71 A72 C02 B91 B99 |
| alerts | B07 B08 B10 C90 |
| geofence | B05 B06 B11 |
| device | A73 B22 B26 B31 B34 B35 B36 D73 F08 D65 D66 |
| outputs | C01 D72 |
| rfid | D10 D11 D12 D13 D14 D15 D16 |
| temperature | C40 C41 C42 C43 C44 C46 |
| fuel | C47 C48 C49 |
| tpms | DA0 DA1 DA2 DA3 DA4 DA5 |
| media | A9A A9B A9C A9D A9E A9F AA0 AA1 AA4 AB2 AB3 AB4 AB5 AB8 B64 BB8 CB8 |
| system | C03 C61 CFF E91 F00 F01 F02 F09 F11 |
| custom | RAW (validated passthrough, e.g. `A19,5`) |

Binary media structs (A9A family) are built as length-prefixed / big-endian / BCD byte structs and travel as hex payloads; the gateway frames them byte-wise (`buildMeitrackBinaryFrame`, checksum over raw bytes).

## Changes by service

**device-gateway-service**
- `application/command-dispatcher.ts` (new) — session lookup, dispatch gate, encode, socket write, SENT/REJECTED feedback.
- `application/session-manager.ts` — `registerWriter`/`writerFor` (mirror of the terminator pattern); writer cleared on close.
- `infrastructure/kafka/command-request-consumer.ts` (new) — per-instance groupId broadcast, owner-only write.
- `infrastructure/kafka/kafka-producer.ts` — `publishCommandEvent` (sent/rejected on the command.ack topic).
- `infrastructure/adapters/meitrack/meitrack.decode.ts` — **echoed-code replies** (`$$..,A11,OK`) now decode as COMMAND_ACK (previously only AAC/D82; others threw ProtocolError). Regex `^(?!AAA)[A-F][0-9A-Z]{2}$`.
- `infrastructure/adapters/meitrack/meitrack.encode.ts` — binary-bodied frames via `payload.hex`.
- Config: `GATEWAY_KAFKA_COMMAND_REQUEST_TOPIC`.

**fleet-management-service**
- Migration `20260817100000_create_device_commands.js` — `fleet.device_commands` (status check constraint, ack-match index, RLS fail-closed).
- `domain/device-command/` — types + the catalog (validation + payload builders ≤1024 bytes per protocol §1.1).
- `application/device-command.service.ts` — validated pipeline, TX + audit, Kafka publish, TTL sweeper.
- `infrastructure/kafka/command-request-producer.ts` + `command-ack-consumer.ts` (handles both reply shapes: echoed code and D82 wrapper).
- `api/device-commands.controller.ts` — catalog / get / issue / list, permissions `telemetry.command.send|read`.
- Config: `FLEET_KAFKA_COMMAND_REQUEST_TOPIC`, `FLEET_KAFKA_COMMAND_ACK_TOPIC`, `FLEET_COMMAND_TTL_SECONDS` (120), `FLEET_COMMAND_SWEEP_SECONDS`.

**identity-service** — backfill migration grants `telemetry.command.send` (fleet-admin) and `telemetry.command.read` (fleet-admin, viewer); tenant-admin wildcard already covers both.

**web-dashboard**
- `api/command.api.ts` + `queryKeys.commands` + `mock/command-data.ts` — catalog fetch, polling history (3s in-flight), send mutation, mock fixtures.
- `pages/CommandCenterPage.tsx` — device Autocomplete (meitrack-only), catalog browser (category tabs + search), param dialog (dynamic fields from catalog defs), history table with live status badges.
- `components/commands/` — CommandCatalogPanel, CommandParamDialog, CommandHistoryTable.
- Permissions `commandRead`/`commandSend` + route/nav guards; i18n en/fa (`commands.*`).

## Known constraints

- **Ack correlation**: Meitrack replies carry no command id — matching is (tenant, device, code) latest-pending. Two rapid identical commands to one device could cross-match; acceptable at platform volumes.
- **Cross-instance dispatch**: broadcast consumer + Redis snapshot ownership check. If the snapshot exists but the owning instance is dead, no reject is published — the TTL sweeper expires the row.
- **Commands only for `protocol=meitrack` devices**; the catalog is MDVR-specific by design.
- Env: meitrack listener enabled by default (`meitrack:tcp:5023` in infra/docker/.env.example).

## Verification

- gateway: 175 tests pass (command-dispatcher, binary encode, echo-decode, session-writer specs).
- fleet-management: 76 tests pass (catalog payload/§cited examples incl. BCD structs, service pipeline).
- web-dashboard: 192 tests pass; typecheck + biome clean across all touched files.
