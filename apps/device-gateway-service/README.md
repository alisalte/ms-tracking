# @fleetvision/device-gateway-service

The FleetVision **Device Gateway** (registry #7, bounded context: Telematics — ingestion tier). The multi-protocol TCP/UDP front tier that terminates vendor binary protocols, authenticates devices, normalizes every payload to one canonical `DeviceMessage`, and forwards the result onto Kafka for `telemetry-ingestion-service` to consume.

Canonical spec: [`docs/specs/06_Device_Gateway.md`](../../docs/specs/06_Device_Gateway.md).

## Sprint 3 scope — Device Gateway Core

This sprint delivers the gateway **core**: the contracts and pipeline every protocol plugs into, with the GT06 reference adapter (Sprint 3), the Meitrack adapter (Sprint 4), the JT808 adapter (Sprint 8), + a stub plugin to prove the path end-to-end. The remaining protocols (JT1078, Teltonika, Concox, Queclink) are later-sprint adapter modules against the same `ProtocolAdapter` contract.

| Component | Where | Spec |
|---|---|---|
| **TCP Server** | `infrastructure/transport/tcp-server.ts` | §3 |
| **Device Session** | `domain/device-session.ts` (aggregate + state machine) | §6, §11.1 |
| **Heartbeat** | `domain/heartbeat.ts` | §12 |
| **Protocol Abstraction** | `infrastructure/protocol/` (adapter interface + registry) | §9 |
| **Plugin System** | `infrastructure/protocol/plugin-loader.ts` | §9.3 |
| **Connection Pool** | `application/connection-pool.ts` | §5 |
| **Packet Dispatcher** | `application/packet-dispatcher.ts` | §8 |
| **Device Registry** | `infrastructure/registry/device-registry.port.ts` (port; durable owner = device-management-service) | §11 |
| **Raw Packet Storage** | `infrastructure/storage/raw-packet-storage.ts` | §10.3, §13.4 |

## Run locally

```bash
# 1. Bring up the lean stack (Postgres+Timescale, Redis, Kafka)
pnpm stack:up

# 2. Run the gateway (tsx watch). Opens the listeners in GATEWAY_LISTENERS.
pnpm --filter @fleetvision/device-gateway-service dev

# 3. Verify
curl http://localhost:8081/health/live   # 200 — process is up
curl http://localhost:8081/admin/stats   # active connections, adapters, capacity
```

Kafka/Redis/Postgres are **non-fatal at boot** (06 §15.4): the gateway starts even when they are down, reconnects lazily, and serves devices from in-memory state meanwhile.

## Environment

Reads from `infra/docker/.env` (copied from `.env.example`). Gateway-specific keys:

| Var | Example | Notes |
|---|---|---|
| `GATEWAY_ADMIN_PORT` | `8081` | Admin HTTP port (health + admin API) |
| `GATEWAY_HOST` | `0.0.0.0` | Bind address for all listeners |
| `GATEWAY_LISTENERS` | `gt06:tcp:5016,meitrack:tcp:5023,jt808:tcp:7611,stub:tcp:5099` | `<adapterId>:<tcp\|udp>:<port>` entries |
| `GATEWAY_MAX_CONNECTIONS` | `100000` | Per-pod connection cap (§5.1) |
| `GATEWAY_TCP_IDLE_TIMEOUT_SECONDS` | `180` | TCP idle timeout (§12.2) |
| `GATEWAY_PLUGIN_DIR` | (empty) | Out-of-tree adapter plugins (§9.3) |
| `GATEWAY_KAFKA_BROKERS` | `localhost:9092` | Event backbone (§13.2) |
| `REDISURL` | `redis://localhost:6379/1` | Session store (§6.2) |
| `DBURL` | `postgres://...` | Listener config table (§16.3) |

## Layout

```
src/
  main.ts                 # bootstrap: validate env → Nest app → graceful shutdown
  app.module.ts           # composition root (config/logger/persistence/redis/health/gateway)
  config/                 # gateway zod schema + listener parser
  domain/                 # DeviceSession aggregate, DeviceMessage, RawPacket, HeartbeatPolicy
  application/            # protocol-agnostic: pool, auth-resolver, session-manager, dispatcher
  api/                    # admin REST + gateway.module wiring
  infrastructure/
    transport/            # TCP/UDP servers + ByteReader (§3, §4)
    protocol/             # ProtocolAdapter contract + AdapterRegistry (PAL) + plugin loader (§9)
    adapters/             # GT06 (reference), Meitrack, JT808, stub (plugin/test) — one module per vendor
    registry/             # DeviceRegistry port + in-memory impl (§11)
    storage/              # SessionRedisStore + RawPacketStorage (§6.2, §10.3)
    kafka/                # batched idempotent producer (§13.2)
    database/migrations/  # telemetry.gateway_listeners (§16.3, open item G-1)
```

## Key invariants (06 §6.1) — enforced + unit-tested

1. A `DeviceMessage` is **never** published before the session is `AUTHENTICATED` (fail-closed).
2. A downstream command is **never** written to a socket in `NEW`/`IDENTIFY`/`CLOSING`.
3. `SessionId` is stable for the connection's life; reconnect yields a new id.

## Adding a protocol (later sprints)

A new vendor protocol is one module under `infrastructure/adapters/<vendor>/` implementing `ProtocolAdapter` (`detect`/`frame`/`decode`/`encode`), registered in `adapters/index.ts`. No core changes — the PAL is the contract.

**Auth models.** Adapters that send a dedicated login packet (GT06) emit `MessageType.LOGIN` and the dispatcher authenticates off it. Adapters that carry the device identity in every packet and send no login (Meitrack — IMEI is the first field of each frame) surface `serialOrImei` on every decoded message; the dispatcher's **implicit-login** path authenticates off the first such packet and then publishes the real payload. Either way the session reaches `AUTHENTICATED` before anything is published.
