# @fleetvision/device-gateway-service

The FleetVision **Device Gateway** (registry #7, bounded context: Telematics — ingestion tier). The multi-protocol TCP/UDP front tier that terminates vendor binary protocols, authenticates devices, normalizes every payload to one canonical `DeviceMessage`, and forwards the result onto Kafka for `telemetry-ingestion-service` to consume.

Canonical spec: [`docs/specs/06_Device_Gateway.md`](../../docs/specs/06_Device_Gateway.md).

## Sprint 3 scope — Device Gateway Core

This sprint delivers the gateway **core**: the contracts and pipeline every protocol plugs into, with the GT06 reference adapter (Sprint 3), the Meitrack adapter (Sprint 4), the JT808 adapter (Sprint 8), the Teltonika adapter (FMB640 and the FMB/FMC family), + a stub plugin to prove the path end-to-end. The remaining protocols (JT1078, Concox, Queclink) are later-sprint adapter modules against the same `ProtocolAdapter` contract.

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
| `GATEWAY_LISTENERS` | `gt06:tcp:5016,meitrack:tcp:5023,jt808:tcp:7611,meitrack+teltonika:tcp:6180,stub:tcp:5099` | `<adapterId>:<tcp\|udp>:<port>` entries; `a+b` or `auto` as adapterId = shared TCP port with per-connection protocol detection |
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
    adapters/             # GT06 (reference), Meitrack, JT808, Teltonika, stub (plugin/test) — one module per vendor
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

## Teltonika (FMB640 and the FMB/FMC family)

Adapter `teltonika`, TCP. In the compose stack it shares port **6180** with Meitrack (`meitrack+teltonika:tcp:6180`): the gateway peeks each new connection's first bytes (`$$` → Meitrack, `00 0F` + 15 digits → Teltonika) and sends it to that adapter's parser — no per-device setup beyond pointing the unit at the port. A dedicated port is also possible (`teltonika:tcp:<port>`). Codecs 8, 8 Extended and 16 for data, Codec 12 for command replies.

**Device setup (Teltonika Configurator → GPRS → Server Settings):** Domain = the gateway host, Port = `6180`, Protocol = **TCP**, Data protocol = Codec 8 / 8 Extended / 16 (any of the three).

**Flow.** The device opens with its IMEI (`00 0F` + 15 ASCII digits); the gateway resolves it against the device registry and answers `0x01` (accept) or `0x00` (reject + close). AVL packets then carry no identity — the session's IMEI is bound onto every record. Each AVL packet is answered with the **number of records stored**, and only *after* every message of the packet was published to Kafka: if Kafka is down the device gets no ack, keeps the records in flash and resends. A packet failing its CRC is likewise not acked.

**Mapping.** Per AVL record: valid GNSS fix (satellites > 0) → `POSITION`; no fix → `TELEMETRY` (never a stale last-known point); an alarm-class event IO (crash 247, towing 246, unplug 252, jamming 249, overspeed 255, green-driving 253, alarm input 236) additionally → `ALARM`. Catalogued IO elements are promoted to named `telemetry` fields (`ignitionOn`, `powerVoltage`, `batteryVoltage`, `odometerKm`, `hdop`, temperatures, CAN fuel/RPM …, see `teltonika.codes.ts`); every IO element is also kept raw under `io["<avlId>"]`.

**Live I/O panel.** Digital inputs/outputs, analog inputs, 1-Wire (Dallas temperature, iButton), RS232/RS485 LLS fuel sensors and CAN J1939 values are grouped into `telemetry.fmbIo` (`teltonika.io-panel.ts`). A record carries only the elements that changed, so the dispatcher merges each record into the Redis hash `tenant:<tid>:vehicle:<vid>:fmbio` (`FmbIoStore`, newest device time wins, 7-day TTL) and publishes the merged panel. gps-engine forwards it on the `position.update` websocket event (not stored in TimescaleDB) and reads the same hash for `GET /positions/:vehicleId/latest`, which covers units without a GPS fix. The dashboard shows it in the device popup. Elements the catalog does not know appear under *Other* with their AVL id. **J1708 and K-Line have no fixed AVL ids** (they depend on the unit's configuration), so they stay under *Other* until their ids are added to `IO_POINTS`. Check the id table against the unit's *Data Sending Parameters* list before rollout, mainly AIN3/AIN4 and DOUT3/DOUT4.

Register the unit with protocol `teltonika` (dashboard → Assets → Devices), or leave `GATEWAY_AUTO_ENROLL` on and it self-registers on first connect.
