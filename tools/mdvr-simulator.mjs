#!/usr/bin/env node
/**
 * MDVR device simulator — end-to-end exercise of the MDVR live-video pipeline
 * WITHOUT physical hardware:
 *
 *   1. Connects to device-gateway's Meitrack listener (TCP 5023) and speaks
 *      the GPRS text protocol: periodic $$ AAA tracking frames (keeps the
 *      session alive + teaches the gateway the IMEI).
 *   2. Listens for the platform's A9A command (@@ … A9A … binary struct),
 *      decodes the media server/port, and dials the mdvr-streamer's video
 *      port. Replies `A9A,OK` like a real device.
 *   3. Streams an H.264 elementary stream as §3.16 binary 0x12 media packets
 *      using the protocol's native fragmentation: NALs ≤950B go out as one
 *      COMPLETE packet; larger NALs chain FIRST/MIDDLE/LAST fragments.
 *
 * H.264 source: `ffmpeg -f lavfi -i testsrc=… -c:v libx264 -f h264 -` piped
 * live (falls back with a clear error when ffmpeg is absent).
 *
 * Usage:
 *   node tools/mdvr-simulator.mjs \
 *     --imei 867191086416152 \
 *     [--gateway 127.0.0.1:5023] [--channel 1]
 *
 * Environment: MDVR_SIM_GATEWAY / MDVR_SIM_IMEI / MDVR_SIM_CHANNEL.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import {
  DataTypes,
  PacketFlags,
  PayloadTypes,
  buildGprsReply,
  buildMediaPacket,
  decodeA9aStruct,
  parseGprsFrame,
  buildGprsBinaryReply,
} from '../packages/meitrack-media-protocol/dist/index.js';

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i !== -1 && args[i + 1]) return args[i + 1];
  return process.env[`MDVR_SIM_${name.toUpperCase()}`] ?? fallback;
}

const IMEI = arg('imei', '867191086416152');
const GATEWAY = arg('gateway', '127.0.0.1:5023');
const CHANNEL = Number(arg('channel', '1'));

const log = (tag, msg) => console.log(`[${new Date().toISOString().substring(11, 23)}] [${tag}] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** §3.16 max body per packet (spec: ≤950 bytes). */
const MAX_BODY = 950;

// ── H.264 NAL source (ffmpeg testsrc, piped) ─────────────────────────────────

/** Async-iterate NAL units from ffmpeg's h264 pipe output. */
async function* nalUnits() {
  const ff = spawn(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error',
      '-re', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=12',
      '-t', '600',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p',
      '-x264-params', 'repeat-headers=1:annexb=1',
      '-f', 'h264', 'pipe:1',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );

  let buf = Buffer.alloc(0);
  let done = false;
  const waiters = [];
  const wake = () => { while (waiters.length) waiters.shift()(); };
  ff.stdout.on('data', (c) => { buf = Buffer.concat([buf, c]); wake(); });
  ff.stdout.on('end', () => { done = true; wake(); });
  ff.on('error', (e) => { log('H264', `ffmpeg error: ${e.message}`); done = true; wake(); });

  for (;;) {
    // Need at least one start code + payload + a following start code (or EOF).
    const nal = extractNal(buf);
    if (nal) {
      buf = buf.subarray(nal.consumed);
      yield nal.unit;
      continue;
    }
    if (done) {
      // Flush any trailing NAL without a terminator.
      const last = extractLastNal(buf);
      if (last) yield last;
      return;
    }
    await new Promise((r) => waiters.push(r));
  }
}

/** Extract the first complete Annex-B NAL (start code … next start code). */
function extractNal(buf) {
  const first = startCodeAt(buf, 0);
  if (first === -1) return null;
  const next = nextStartCode(buf, first.len);
  if (next === -1) return null;
  return {
    unit: Buffer.concat([buf.subarray(first.pos, first.pos + first.len), buf.subarray(first.pos + first.len, next)]),
    consumed: next,
  };
}

/** Trailing NAL at EOF (no following start code). */
function extractLastNal(buf) {
  const first = startCodeAt(buf, 0);
  if (first === -1 || buf.length <= first.pos + first.len) return null;
  return Buffer.concat([buf.subarray(first.pos, first.pos + first.len), buf.subarray(first.pos + first.len)]);
}

function startCodeAt(buf, from) {
  for (let i = from; i + 3 <= buf.length; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) return { pos: i, len: 3 };
    if (i + 4 <= buf.length && buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 0 && buf[i + 3] === 1) {
      return { pos: i, len: 4 };
    }
  }
  return -1;
}

function nextStartCode(buf, from) {
  for (let i = from; i + 3 <= buf.length; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) return i;
    if (i + 4 <= buf.length && buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 0 && buf[i + 3] === 1) {
      return i;
    }
  }
  return -1;
}

// ── 1. Command channel (device-gateway) ──────────────────────────────────────
const [gwHost, gwPort] = GATEWAY.split(':');
const cmdSock = net.connect(Number(gwPort), gwHost, () => {
  log('CMD', `connected to gateway ${GATEWAY}`);
  sendTracking();
  heartbeat = setInterval(sendTracking, 30_000);
  dmsTimer = setInterval(sendDmsAlarm, Number(arg('dmsInterval', '45')) * 1000);
  // First DMS alarm shortly after connect so a demo shows up fast.
  setTimeout(sendDmsAlarm, 5000);
});
let heartbeat = null;
let dmsTimer = null;

function sendTracking() {
  const lat = (35.7 + Math.random() * 0.01).toFixed(6);
  const lng = (51.4 + Math.random() * 0.01).toFixed(6);
  // AAA layout: imei,AAA,event(0),lat,lng,YYMMDDHHMMSS,validity,sats,rssi,
  // speed,heading,hdop,alt,odo,runtime,cell,in,out — event 0 = periodic track.
  const now = new Date();
  const ymdhms = [
    String(now.getUTCFullYear() % 100).padStart(2, '0'),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('');
  cmdSock.write(
    buildGprsReply(IMEI, 'AAA', `0,${lat},${lng},${ymdhms},A,8,60,40,90,1.2,120,5000,3600,432|mtn|1a2b|3c4d,01,00,4.1|13.2`),
  );
  log('CMD', `AAA tracking sent (${lat},${lng})`);
}

// ── DMS alarm emission (event 126 CCE + 0xFE31 detail) ───────────────────────

/** Cycle through the DMS alarm types so the whole catalog is exercised. */
const DMS_CYCLE = [
  { protocol: 2, type: 7, name: 'phone call' },
  { protocol: 2, type: 5, name: 'drowsiness' },
  { protocol: 2, type: 8, name: 'smoking' },
  { protocol: 2, type: 10, name: 'driver absence' },
  { protocol: 2, type: 128, name: 'forward collision (ADAS)' },
  { protocol: 2, type: 6, name: 'yawning' },
];
let dmsIdx = 0;

/** Build + send one CCE DMS alarm frame (the MDVR's binary telemetry format). */
function sendDmsAlarm() {
  const dms = DMS_CYCLE[dmsIdx % DMS_CYCLE.length];
  dmsIdx++;

  const ts = Math.floor((Date.now() - Date.UTC(2000, 0, 1)) / 1000);
  const lat = Math.round((35.7 + Math.random() * 0.01) * 1e6);
  const lng = Math.round((51.4 + Math.random() * 0.01) * 1e6);
  const photo = Buffer.from(`2408231200${String(dmsIdx).padStart(2, '0')}_CH2_E126S${dms.type}_0.jpg\0`, 'ascii');
  const fe31 = Buffer.concat([Buffer.from([photo.length + 2, dms.protocol, dms.type]), photo]);

  const params = Buffer.concat([
    Buffer.from([3, 0x08, 40, 0, 0x09, 90, 0, 0x40, 126, 0]), // speed, heading, event=126
    Buffer.from([3, 0x02, lng & 0xff, (lng >> 8) & 0xff, (lng >> 16) & 0xff, (lng >> 24) & 0xff, 0x03, lat & 0xff, (lat >> 8) & 0xff, (lat >> 16) & 0xff, (lat >> 24) & 0xff, 0x04, ts & 0xff, (ts >> 8) & 0xff, (ts >> 16) & 0xff, (ts >> 24) & 0xff]),
    Buffer.from([1, 0xfe, 0x31, fe31.length]),
    fe31,
  ]);

  cmdSock.write(buildGprsBinaryReply(IMEI, 'CCE', params));
  log('DMS', `CCE alarm sent — ${dms.name} (proto ${dms.protocol}, type ${dms.type})`);
}

let cmdBuf = Buffer.alloc(0);
cmdSock.on('data', (chunk) => {
  cmdBuf = Buffer.concat([cmdBuf, chunk]);
  for (;;) {
    const res = parseGprsFrame(cmdBuf);
    if (res.status === 'invalid') { cmdBuf = cmdBuf.subarray(1); continue; }
    if (res.status === 'incomplete') break;
    cmdBuf = cmdBuf.subarray(res.consumed);
    log('CMD', `frame from platform: ${res.commandCode} ${res.content.slice(0, 50)}`);
    if (res.commandCode === 'A9A') {
      onA9a(res.content);
    }
  }
});
cmdSock.on('error', (e) => log('CMD', `error: ${e.message}`));
cmdSock.on('close', () => {
  log('CMD', 'gateway connection closed');
  clearInterval(heartbeat);
  clearInterval(dmsTimer);
});

// ── 2/3. A9A → media dialback → 0x12 packet stream ───────────────────────────

let mediaStarted = false;

function onA9a(content) {
  // parseGprsFrame already consumed the "A9A," separator — `content` IS the
  // raw §3.16 struct bytes (ip_len + ip + tcp + udp + ch + data + stream).
  const struct = Buffer.from(content, 'binary');
  const a9a = decodeA9aStruct(struct);
  if (!a9a) {
    log('CMD', 'A9A struct could not be decoded');
    return;
  }
  log('CMD', `A9A decoded → media ${a9a.server}:${a9a.tcpPort} ch${a9a.channel}`);
  cmdSock.write(buildGprsReply(IMEI, 'A9A', 'OK'));
  if (!mediaStarted) startMedia(a9a.server, a9a.tcpPort, a9a.channel);
}

async function startMedia(host, port, channel) {
  mediaStarted = true;
  log('MEDIA', `dialing ${host}:${port} …`);
  const sock = net.connect(port, host, async () => {
    log('MEDIA', 'connected — streaming 0x12 packets');
    let seq = 0;
    let packets = 0;
    for await (const nal of nalUnits()) {
      if (sock.destroyed) return;
      for (const pkt of nalToPackets(nal, (n) => (seq + n) & 0xffff, channel)) {
        sock.write(pkt);
        seq++;
        packets++;
      }
      if (packets % 300 === 0) log('MEDIA', `${packets} packets sent`);
      await sleep(6); // gentle pacing (~real device cadence)
    }
    log('MEDIA', 'NAL source exhausted — holding connection open');
  });
  sock.on('error', (e) => log('MEDIA', `error: ${e.message}`));
  sock.on('close', () => log('MEDIA', 'media connection closed'));
}

/** One NAL → COMPLETE (small) or FIRST/MIDDLE…/LAST fragments (large). */
function nalToPackets(nal, seqAt, channel) {
  const nalType = (nal[nal.length - 1] ?? 0) & 0x1f; // nal starts with its own start code
  const dataType = nalType === 5 || nalType === 7 || nalType === 8 ? DataTypes.I_FRAME : DataTypes.P_FRAME;
  // The NAL from the generator INCLUDES its Annex-B start code; §3.16 bodies
  // in the real device also carry the start code — keep it.
  if (nal.length <= MAX_BODY) {
    return [
      buildMediaPacket({
        imei: IMEI,
        channel,
        dataType,
        packetFlag: PacketFlags.COMPLETE,
        payloadType: PayloadTypes.H264,
        packetNo: seqAt(0),
        timestamp: Date.now(),
        payload: nal,
      }),
    ];
  }
  const pkts = [];
  for (let off = 0, i = 0; off < nal.length; off += MAX_BODY, i++) {
    const isLast = off + MAX_BODY >= nal.length;
    const flag = i === 0 ? PacketFlags.FIRST : isLast ? PacketFlags.LAST : PacketFlags.MIDDLE;
    pkts.push(
      buildMediaPacket({
        imei: IMEI,
        channel,
        dataType,
        packetFlag: flag,
        payloadType: PayloadTypes.H264,
        packetNo: seqAt(i),
        timestamp: Date.now(),
        payload: nal.subarray(off, Math.min(off + MAX_BODY, nal.length)),
      }),
    );
  }
  return pkts;
}

process.on('SIGINT', () => {
  log('SIM', 'shutting down');
  cmdSock.destroy();
  process.exit(0);
});

log('SIM', `MDVR simulator ready — IMEI ${IMEI}, gateway ${GATEWAY}, channel ${CHANNEL}`);
log('SIM', 'waiting for the platform to send A9A (start it from the Video Wall).');
