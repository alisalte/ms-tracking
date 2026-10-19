import net from 'node:net';
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { FtpPhotoIngest, ftpPasswordFor } from '../application/ftp-photo-ingest.js';
import { PHOTO_ATTACHABLE_STATUSES } from '../domain/evidence-photo.js';
import { FtpPhotoServer, type FtpUploadedFile } from '../infrastructure/ftp/ftp-photo-server.js';

const IMEI = '864507031234567';
const SECRET = 'test-secret';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x2c, 0x0d, 0x0a, 0xff, 0xd9]);

/** Line-oriented FTP control client: send a command, await the final reply. */
class Control {
  private buf = '';
  private waiters: ((line: string) => void)[] = [];
  private lines: string[] = [];

  constructor(private readonly socket: net.Socket) {
    socket.setEncoding('latin1');
    socket.on('data', (d: string) => {
      this.buf += d;
      let i = this.buf.indexOf('\r\n');
      while (i >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 2);
        if (/^\d{3} /.test(line)) {
          const w = this.waiters.shift();
          if (w) w(line);
          else this.lines.push(line);
        }
        i = this.buf.indexOf('\r\n');
      }
    });
  }

  public next(): Promise<string> {
    const l = this.lines.shift();
    if (l) return Promise.resolve(l);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  public async cmd(line: string): Promise<string> {
    this.socket.write(`${line}\r\n`);
    return this.next();
  }
}

async function connect(port: number): Promise<{ control: Control; socket: net.Socket }> {
  const socket = net.connect(port, '127.0.0.1');
  await new Promise((r) => socket.once('connect', r));
  const control = new Control(socket);
  expect(await control.next()).toMatch(/^220 /);
  return { control, socket };
}

describe('FtpPhotoServer', () => {
  let server: FtpPhotoServer | null = null;
  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  it('accepts a passive-mode STOR from a logged-in unit and hands over the bytes', async () => {
    const files: FtpUploadedFile[] = [];
    server = new FtpPhotoServer({
      host: '127.0.0.1',
      port: 0,
      passiveHost: '127.0.0.1',
      passivePorts: [39100, 39109],
      maxFileBytes: 1024,
      authenticate: (u, p) => u === IMEI && p === 'pw',
      onFile: async (f) => {
        files.push(f);
      },
    });
    const port = await server.start();
    const { control, socket } = await connect(port);

    expect(await control.cmd(`USER ${IMEI}`)).toMatch(/^331 /);
    expect(await control.cmd('PASS wrong')).toMatch(/^530 /);
    expect(await control.cmd(`USER ${IMEI}`)).toMatch(/^331 /);
    expect(await control.cmd('PASS pw')).toMatch(/^230 /);
    expect(await control.cmd('TYPE I')).toMatch(/^200 /);
    expect(await control.cmd('MKD alarm')).toMatch(/^257 /);
    expect(await control.cmd('CWD alarm')).toMatch(/^250 /);

    const pasv = await control.cmd('PASV');
    const m = /\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/.exec(pasv);
    if (!m) throw new Error(`bad PASV reply: ${pasv}`);
    const dataPort = Number(m[5]) * 256 + Number(m[6]);
    const data = net.connect(dataPort, '127.0.0.1');
    await new Promise((r) => data.once('connect', r));

    expect(await control.cmd('STOR 20261019055951_CH1_dca.jpg')).toMatch(/^150 /);
    data.end(JPEG);
    expect(await control.next()).toMatch(/^226 /);
    expect(await control.cmd('QUIT')).toMatch(/^221 /);
    socket.destroy();

    await new Promise((r) => setTimeout(r, 20));
    expect(files).toHaveLength(1);
    expect(files[0]?.user).toBe(IMEI);
    expect(files[0]?.path).toBe('/alarm/20261019055951_CH1_dca.jpg');
    expect(files[0]?.bytes.equals(JPEG)).toBe(true);
  });

  it('refuses uploads before login and files over the size cap', async () => {
    server = new FtpPhotoServer({
      host: '127.0.0.1',
      port: 0,
      passiveHost: '127.0.0.1',
      passivePorts: [39110, 39119],
      maxFileBytes: 4,
      authenticate: () => true,
      onFile: async () => undefined,
    });
    const port = await server.start();
    const { control, socket } = await connect(port);
    expect(await control.cmd('STOR x.jpg')).toMatch(/^530 /);
    await control.cmd('USER 1');
    await control.cmd('PASS x');
    const pasv = await control.cmd('EPSV');
    const dataPort = Number(/\(\|\|\|(\d+)\|\)/.exec(pasv)?.[1]);
    const data = net.connect(dataPort, '127.0.0.1');
    data.on('error', () => undefined);
    await new Promise((r) => data.once('connect', r));
    expect(await control.cmd('STOR big.jpg')).toMatch(/^150 /);
    data.write(JPEG);
    expect(await control.next()).toMatch(/^552 /);
    socket.destroy();
  });
});

describe('FtpPhotoIngest', () => {
  const device = { deviceId: 'dev-1', tenantId: 'ten-1', status: 'ACTIVE', protocol: 'MEITRACK' };

  function build(byName: number[], byStem: number[] = [0]) {
    let now = 1_000_000;
    const markPhotoReadyByName = jest.fn(async () => byName.shift() ?? 0);
    const markPhotoReadyByStem = jest.fn(async () => byStem.shift() ?? 0);
    const ingest = new FtpPhotoIngest({
      secret: SECRET,
      devices: {
        resolveByImei: async (imei: string) =>
          imei === IMEI
            ? { found: true, tenantActive: true, device: { ...device, vehicleId: null } }
            : { found: false, tenantActive: false },
      } as never,
      evidence: { markPhotoReadyByName, markPhotoReadyByStem },
      compression: { maxEdge: 0, quality: 50 },
      now: () => now,
    });
    return {
      ingest,
      markPhotoReadyByName,
      markPhotoReadyByStem,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  it('authenticates only the IMEI with its derived password', () => {
    const { ingest } = build([]);
    const pw = ftpPasswordFor(SECRET, IMEI);
    expect(ingest.authenticate(IMEI, pw)).toBe(true);
    expect(ingest.authenticate(IMEI, 'nope')).toBe(false);
    expect(ingest.authenticate('864507039999999', pw)).toBe(false);
    ingest.stop();
  });

  it('attaches by the reported name, then by time+camera stem', async () => {
    const { ingest, markPhotoReadyByName, markPhotoReadyByStem } = build([0], [1]);
    await ingest.onFile({ user: IMEI, path: '/a/20261019055951_CH1_dca_1.jpg', bytes: JPEG });
    expect(markPhotoReadyByName).toHaveBeenCalledWith(
      'ten-1',
      'dev-1',
      '20261019055951_CH1_dca_1.jpg',
      JPEG,
      'image/jpeg',
    );
    expect(markPhotoReadyByStem).toHaveBeenCalledWith(
      'ten-1',
      'dev-1',
      '20261019055951_CH1',
      JPEG,
      'image/jpeg',
    );
    expect(ingest.pendingCount).toBe(0);
    ingest.stop();
  });

  it('keeps an unmatched photo until its alarm row shows up, then drops it after the window', async () => {
    const { ingest, markPhotoReadyByName, advance } = build([0, 0, 1], [0, 0, 0]);
    await ingest.onFile({ user: IMEI, path: '/20261019055951_CH1_dca.jpg', bytes: JPEG });
    expect(ingest.pendingCount).toBe(1);
    await ingest.retryUnmatched();
    expect(ingest.pendingCount).toBe(1);
    await ingest.retryUnmatched();
    expect(ingest.pendingCount).toBe(0);
    expect(markPhotoReadyByName).toHaveBeenCalledTimes(3);

    const late = build([0, 0], [0, 0]);
    await late.ingest.onFile({ user: IMEI, path: '/x_CH1.jpg', bytes: JPEG });
    late.advance(11 * 60_000);
    await late.ingest.retryUnmatched();
    expect(late.ingest.pendingCount).toBe(0);
    ingest.stop();
    late.ingest.stop();
    advance(0);
  });

  it('ignores non-JPEG uploads and unknown units', async () => {
    const { ingest, markPhotoReadyByName } = build([]);
    await ingest.onFile({ user: IMEI, path: '/clip.mp4', bytes: Buffer.from('ftyp') });
    await ingest.onFile({ user: '111111111111111', path: '/a.jpg', bytes: JPEG });
    expect(markPhotoReadyByName).not.toHaveBeenCalled();
    ingest.stop();
  });
});

describe('photo attach targets', () => {
  it('lets a delivered photo fill cooldown-skipped rows, not just pending/failed ones', () => {
    expect(PHOTO_ATTACHABLE_STATUSES).toEqual(
      expect.arrayContaining(['PENDING', 'FETCHING', 'PHOTO_FAILED', 'SKIPPED_COOLDOWN']),
    );
    expect(PHOTO_ATTACHABLE_STATUSES).not.toContain('PHOTO_READY');
  });
});
