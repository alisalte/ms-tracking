/**
 * mdvr-streamer bootstrap — the MDVR live-video media plane.
 *
 *   VIDEO_PORT (default 6182)  device TCP dialback: binary 0x12 media packets
 *                              -> NAL reassembly -> ffmpeg -> MPEG-TS
 *   PORT (default 3013)        HTTP status API + binary WebSocket (JSMpeg)
 *
 * The device is told to dial back here by the A9A command, which the platform
 * sends over the existing command path (dashboard -> fleet-management ->
 * Kafka -> device-gateway -> device). This service owns ONLY the media plane.
 */
import { streamerConfigSchema } from './config.js';
import { startHttpApi } from './http-api.js';
import { LateBoundSink, StreamRegistry } from './stream-session.js';
import { startVideoServer } from './video-server.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

function bootstrap(): void {
  const config = streamerConfigSchema.parse(process.env);

  const min = LEVELS[config.LOG_LEVEL];
  const log = (tag: string, msg: string) => {
    const ts = new Date().toISOString().substring(11, 23);
    console.log(`[${ts}] [${tag}] ${msg}`);
  };
  const logAt = (level: keyof typeof LEVELS) => (min <= LEVELS[level] ? log : () => undefined);

  const startedAt = Date.now();
  const sink = new LateBoundSink();
  const registry = new StreamRegistry(config, sink, logAt('info'));

  const video = startVideoServer(config, registry, logAt('info'));
  const api = startHttpApi(config, registry, video, startedAt, logAt('info'));
  sink.bind(api.hub);

  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      '========================================================',
      '  FleetVision MDVR Live Video Streamer — READY',
      '========================================================',
      `  Device media (TCP) : :${config.VIDEO_PORT}`,
      `  Players (HTTP/WS)  : :${config.PORT}`,
      '  Triggered via A9A through the platform command path.',
      '========================================================',
      '',
    ].join('\n'),
  );

  const shutdown = (sig: string) => {
    log('SRV', `${sig} received, shutting down`);
    for (const s of registry.snapshot()) registry.close(s.imei);
    video.server.close();
    api.server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap();
