/**
 * Meitrack MDVR device simulator — E2E driver for the command round-trip.
 *
 * 1. Connects to the gateway's meitrack listener (127.0.0.1:5023).
 * 2. Sends an AAA tracking packet (implicit login via IMEI).
 * 3. Waits for downstream @@ frames; when the A12 config command arrives,
 *    replies with the echoed-code OK response ($$..,A12,OK) per MDVR V2.0 §3.3.
 * 4. Prints every frame exchanged, exits 0 on success.
 */
import net from 'node:net';

const IMEI = '866854036516451';
const HOST = '127.0.0.1';
const PORT = 5023;

function checksum(bytes) {
  let sum = 0;
  for (const b of bytes) sum = (sum + b) & 0xff;
  return sum.toString(16).toUpperCase().padStart(2, '0');
}

/** Device → server frame: $$A<len>,<content>*<cc>\r\n */
function deviceFrame(content) {
  const commaBlock = `,${content}`;
  const length = commaBlock.length + 1 + 2 + 2; // '*' + cc(2) + \r\n(2)
  const head = `$$A${String(length).padStart(4, '0')}`;
  const region = Buffer.from(`${head}${commaBlock}*`, 'ascii');
  return Buffer.from(`${region.toString('ascii')}${checksum(region)}\r\n`, 'ascii');
}

const now = new Date();
const p = (n, w = 2) => String(n).padStart(w, '0');
const stamp = `${p(now.getFullYear() % 100)}${p(now.getMonth() + 1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;

// AAA body per Meitrack v1.6 §field order (see gateway decode): event 35 (track by time interval).
const aaa = [
  IMEI,
  'AAA',
  35,
  '22.913191',
  '114.079882',
  stamp,
  'A',
  10,
  4,
  38,
  120,
  7,
  55,
  1234567,
  987654,
  '460|0|1234|5678',
  '01',
  '00',
  '4.10|13.18',
].join(',');

const socket = net.connect(PORT, HOST, () => {
  console.log('[sim] connected — sending AAA tracking packet');
  socket.write(deviceFrame(aaa));
});

let sawAckReply = false;
let buffer = Buffer.alloc(0);

socket.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  // Frames end with \r\n.
  let idx;
  while ((idx = buffer.indexOf('\r\n')) !== -1) {
    const frame = buffer.subarray(0, idx + 2);
    buffer = buffer.subarray(idx + 2);
    const text = frame.toString('ascii');
    console.log('[sim] << received:', text.trim());

    // Downstream config command A12? Reply with the echoed-code OK (§3.3).
    if (text.startsWith('@@') && text.includes(`,A12,`)) {
      console.log('[sim] >> replying A12,OK');
      socket.write(deviceFrame(`${IMEI},A12,OK`));
      sawAckReply = true;
      // Also exercise a query ack: E91.
      setTimeout(() => {
        console.log('[sim] done — ack reply sent');
        socket.end();
        process.exit(sawAckReply ? 0 : 1);
      }, 1500);
    }
  }
});

socket.on('error', (err) => {
  console.error('[sim] socket error:', err.message);
  process.exit(1);
});

// Keep alive for at most 90s.
setTimeout(() => {
  console.error('[sim] timeout — no A12 command received');
  process.exit(1);
}, 90_000);
