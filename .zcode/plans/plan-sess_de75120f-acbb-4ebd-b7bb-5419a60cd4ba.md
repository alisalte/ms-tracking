## Sprint 10 — Video Gateway

### Goal
Create **`apps/media-service`** (`@fleetvision/media-service`, registry #10) — the control-plane orchestrator for the Media & Video bounded context. Manages the video channel registry, stream-session lifecycle, protocol-adapter abstraction (JT1078/RTSP), the canonical MediaFrame pipeline, codec decisions (H264/H265), multi-channel sessions, and WebSocket signaling. Covers all six deliverables: **JT1078, RTSP, Stream Manager, H264, H265, Multi-Channel**.

### Architecture (per spec 09/10)
The video platform splits into two tiers:
- **`media-service`** (Node/NestJS/TS, registry #10) — **this sprint**. The orchestrator: channel registry, stream sessions, protocol adapters, codec strategy, signaling relay, REST API, metadata in PostgreSQL `media.*`, session state in Redis.
- **`media-router`/SFU** (infra-class, registry #11) — the actual media pipeline (Pion/mediasoup). Not a NestJS business-logic service. For Sprint 10 I define the **`MediaRouter` port** (the gRPC-style interface) with a **stub implementation** — the real SFU is wired when the infra component deploys. Same proven pattern as Map Engine's `MapProvider`.

### What I verified (exact contracts)
From `09_Video_Gateway.md` + `10_Live_Video.md`:

- **JT1078** (§3.5): RTP-over-TCP, companion to JT808. Frame: `0x30 0x31` header, length, seq, BCD SIM, logical channel, alarm flag, sample count, **8-byte BCD timestamp (Beijing→UTC)**, data type, stream type (**98=H.264, 99=H.265, 100=AAC**). Gated by JT808 `0x9101`/`0x9103`. Port 1078.
- **RTSP** (§3.3): Pull from IP cameras. `OPTIONS→DESCRIBE(SDP)→SETUP→PLAY→RTP→TEARDOWN`. Keepalive 30s.
- **Stream Manager** (§5): Two lifecycles — `VideoChannel` (long-lived: REGISTERED→ONLINE→DEGRADED→OFFLINE) and `StreamSession` (short-lived: CONNECTING→ACTIVE→DEGRADED→CLOSED). Lazy activation: zero bandwidth with no viewers.
- **H264/H265** (§6): H.264→passthrough (preferred). H.265→ingest for recording (40% smaller), transcode→H.264 only for WebRTC live. Codec decision is per-session.
- **Multi-Channel** (§8.4): Each camera=independent `VideoChannel` with `logicalChannel`. Batch open `POST /streams/batch`.
- **MediaFrame** (§2.4): `{channelId, streamType, kind, payload, isKeyframe, timestamp, wallClock, sourceMeta, seq}`.
- **Signaling** (§3.7/10§4): Socket.IO carries offer/answer/ICE only. Per-stream signaling token (Redis, 5min TTL).
- **DB** (§7.3): `media.video_channels`, `media.stream_sessions`. Kafka: `fleetvision.media.channel.events`, `fleetvision.media.stream.events`.

---

### Files to create

**Scaffold** (mirroring gps-engine/map-engine):
1. `apps/media-service/package.json` — `@fleetvision/media-service`; deps: `@fleetvision/*` + `@nestjs/*` 10.4.15 + `socket.io` 4.7.2 + `@socket.io/redis-adapter` 8.3.0 + `kafkajs` 2.2.4 + `zod`.
2. `apps/media-service/tsconfig.json` + `jest.config.js`.
3. `src/main.ts` — bootstrap.
4. `src/app.module.ts` — composition root.
5. `src/config/media.config.ts` — `baseConfigSchema.merge(z.object({ DBURL, REDISURL, MEDIA_KAFKA_*, MEDIA_WS_PORT, MEDIA_WS_ENABLED, MEDIA_ROUTER_URL }))`.

**Domain** (`src/domain/`):
6. `video-channel.ts` — `VideoChannel` aggregate (channelId, tenantId, vehicleId/siteId, label, logicalChannel, protocol JT1078/RTSP, codec H264/H265, status). States: REGISTERED→ONLINE→DEGRADED→OFFLINE→DECOMMISSIONED.
7. `stream-session.ts` — `StreamSession` (sessionId, channelId, mode LIVE/PLAYBACK/RECORD/AI, quality, state, viewerCount). States: CONNECTING→ACTIVE→DEGRADED→CLOSED.
8. `media-frame.ts` — canonical `MediaFrame` interface + JT1078 stream-type constants (98=H264, 99=H265, 100=AAC).
9. `codec-strategy.ts` — pure codec decision: given camera codec + delivery mode → passthrough or transcode.
10. `signaling-token.ts` — opaque token (256-bit, 5min TTL, binds session+channel+tenant+user).

**Application** (`src/application/`):
11. `stream-manager.ts` — stream-session orchestrator: openSession, closeSession, addViewer, removeViewer. Lazy activation.
12. `channel-manager.ts` — VideoChannel CRUD + lifecycle.
13. `protocol-registry.ts` — selects adapter by channel.protocol.

**Infrastructure** (`src/infrastructure/`):
14. `protocol/protocol-adapter.ts` — the `ProtocolAdapter` port.
15. `protocol/jt1078-adapter.ts` — JT1078 frame parser: `0x30 0x31` header decode, BCD timestamp (Beijing→UTC), stream-type (98/99/100), alarm flag → `MediaFrame`.
16. `protocol/rtsp-adapter.ts` — RTSP control flow + SDP codec parsing.
17. `media-router-port.ts` — the `MediaRouter` port + stub implementation.
18. `signaling/signaling-gateway.ts` — Socket.IO server (stream.subscribe/offer/answer/ice/unsubscribe). Token verification.
19. `cache/redis-session-cache.ts` — signaling tokens + channel→pod affinity.
20. `persistence/channel.repository.ts` — `media.video_channels` CRUD.
21. `persistence/session.repository.ts` — `media.stream_sessions` CRUD.
22. `database/migrations/20260806130000_create_media_schema.js` — `CREATE SCHEMA media`; video_channels + stream_sessions (partitioned). RLS.

**API** (`src/api/`):
23. `streams.controller.ts` — `POST /streams`, `POST /streams/batch`, `DELETE /streams/:id`, `GET/POST /channels`, `GET /channels/:id`.
24. `media.module.ts` + `tokens.ts`.

**Tests** (`src/__tests__/`):
25. `jt1078-adapter.spec.ts` — frame parsing (header, BCD timestamp, stream-type, keyframe).
26. `codec-strategy.spec.ts` — H264→passthrough, H265→transcode for WebRTC / passthrough for recording.
27. `rtsp-adapter.spec.ts` — SDP codec detection, keepalive.
28. `stream-manager.spec.ts` — lazy activation, session lifecycle, viewer count.
29. `signaling-token.spec.ts` — token gen + verify + expiry.

### Scope decisions
- **Media-router/SFU stub**: The `MediaRouter` port is defined; Sprint 10 ships a stub returning synthetic SDP. Real SFU (Pion/mediasoup) is infra-class, deployed separately.
- **JT1078 adapter parses frames, doesn't own TCP**: The adapter implements frame decode (the hard part). TCP listener is the media-router's job. Exercised in tests with raw frame buffers.
- **WebSocket signaling is functional**: Full message catalog, token verification — but SDP offer/answer is stubbed (no real SFU).
- **No external media deps**: No mediasoup/Pion/ffmpeg/TURN in Sprint 10.

### Definition of Done
- `pnpm install` succeeds.
- `pnpm --filter @fleetvision/media-service test` passes.
- `pnpm typecheck` and `pnpm lint` clean.
- Service boots and serves REST endpoints without a media server.
- JT1078 frame parsing verified against the spec byte layout.
- Codec strategy verified (H264 passthrough, H265 transcode for live).

### Execution order
1. Scaffold (package.json, tsconfig, main, app.module, config).
2. Migration (media schema).
3. Domain (VideoChannel, StreamSession, MediaFrame, codec strategy, signaling token).
4. Infrastructure (JT1078 adapter, RTSP adapter, media-router port/stub, signaling gateway, Redis cache, repos).
5. Application (stream manager, channel manager, protocol registry).
6. API controllers + module wiring.
7. Tests (frame parsing, codec strategy, stream manager, signaling).
8. Lint/typecheck/full-suite sweep.