/**
 * FtpPhotoServer — a minimal upload-only FTP server for MDVR alarm photos.
 *
 * The MD300 pushes event snapshots to the FTP server configured with B64
 * (MDVR GPRS Protocol V2.0 §3.45). Only what an embedded FTP client needs is
 * implemented: login, the directory commands it issues before storing
 * (answered against a virtual tree, nothing touches the disk), passive and
 * active data connections, and STOR/APPE. Uploaded bytes stay in memory and
 * are handed to `onFile`; a cellular unit sits behind CGNAT, so passive mode
 * is the path that actually works and `passiveHost` must be the public IP.
 */
import net from 'node:net';
import { posix } from 'node:path';

export interface FtpUploadedFile {
  /** Login name (the device IMEI). */
  readonly user: string;
  /** Absolute virtual path the client stored, e.g. `/20261019055951_CH1_dca.jpg`. */
  readonly path: string;
  readonly bytes: Buffer;
}

export interface FtpPhotoServerOptions {
  readonly host: string;
  readonly port: number;
  /** IPv4 advertised in PASV replies. */
  readonly passiveHost: string;
  /** Inclusive passive data port range. */
  readonly passivePorts: readonly [number, number];
  readonly maxFileBytes: number;
  readonly maxSessions?: number;
  readonly authenticate: (user: string, password: string) => boolean;
  readonly onFile: (file: FtpUploadedFile) => Promise<void>;
  readonly log?: (message: string) => void;
}

const CONTROL_IDLE_MS = 120_000;
const DATA_CONNECT_MS = 30_000;

export class FtpPhotoServer {
  private server: net.Server | null = null;
  private readonly sessions = new Set<FtpSession>();
  private readonly busyPassivePorts = new Set<number>();

  constructor(private readonly opts: FtpPhotoServerOptions) {}

  public async start(): Promise<number> {
    const server = net.createServer((socket) => {
      if (this.sessions.size >= (this.opts.maxSessions ?? 50)) {
        socket.end('421 Too many connections.\r\n');
        return;
      }
      const session = new FtpSession(socket, this.opts, this.busyPassivePorts);
      this.sessions.add(session);
      socket.once('close', () => this.sessions.delete(session));
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.opts.port, this.opts.host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    return typeof address === 'object' && address ? address.port : this.opts.port;
  }

  public async stop(): Promise<void> {
    for (const s of this.sessions) s.close();
    this.sessions.clear();
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

type DataTarget =
  | { readonly kind: 'passive'; readonly socket: Promise<net.Socket>; readonly close: () => void }
  | { readonly kind: 'active'; readonly host: string; readonly port: number };

class FtpSession {
  private buffer = '';
  private user = '';
  private authed = false;
  private cwd = '/';
  private data: DataTarget | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly socket: net.Socket,
    private readonly opts: FtpPhotoServerOptions,
    private readonly busyPorts: Set<number>,
  ) {
    socket.setEncoding('latin1');
    socket.setTimeout(CONTROL_IDLE_MS, () => this.close());
    socket.on('error', () => this.close());
    socket.on('data', (chunk: string) => this.onData(chunk));
    socket.once('close', () => this.dropData());
    this.reply(220, 'FleetVision photo FTP ready.');
  }

  public close(): void {
    this.dropData();
    this.socket.destroy();
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 8192) {
      this.close();
      return;
    }
    let idx = this.buffer.indexOf('\n');
    while (idx >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, '');
      this.buffer = this.buffer.slice(idx + 1);
      // Commands run strictly in order: STOR must finish before QUIT closes.
      this.queue = this.queue.then(() => this.handle(line)).catch(() => this.close());
      idx = this.buffer.indexOf('\n');
    }
  }

  private reply(code: number, text: string): void {
    if (!this.socket.destroyed) this.socket.write(`${code} ${text}\r\n`);
  }

  private resolvePath(arg: string): string {
    return posix.normalize(posix.isAbsolute(arg) ? arg : posix.join(this.cwd, arg || '.'));
  }

  private async handle(line: string): Promise<void> {
    const space = line.indexOf(' ');
    const cmd = (space < 0 ? line : line.slice(0, space)).toUpperCase();
    const arg = space < 0 ? '' : line.slice(space + 1).trim();

    switch (cmd) {
      case 'USER':
        this.user = arg;
        this.authed = false;
        return this.reply(331, 'Password required.');
      case 'PASS':
        if (this.user && this.opts.authenticate(this.user, arg)) {
          this.authed = true;
          return this.reply(230, 'Logged in.');
        }
        this.opts.log?.(`FTP login rejected user=${this.user || '-'}`);
        return this.reply(530, 'Login incorrect.');
      case 'QUIT':
        this.reply(221, 'Bye.');
        this.socket.end();
        return;
      case 'NOOP':
        return this.reply(200, 'OK.');
      case 'SYST':
        return this.reply(215, 'UNIX Type: L8');
      case 'FEAT':
        if (!this.socket.destroyed) {
          this.socket.write('211-Features:\r\n PASV\r\n EPSV\r\n UTF8\r\n211 End\r\n');
        }
        return;
      case 'OPTS':
        return this.reply(200, 'OK.');
    }

    if (!this.authed) return this.reply(530, 'Please log in.');

    switch (cmd) {
      case 'PWD':
      case 'XPWD':
        return this.reply(257, `"${this.cwd}" is the current directory.`);
      case 'CWD':
      case 'XCWD':
        this.cwd = this.resolvePath(arg);
        return this.reply(250, 'OK.');
      case 'CDUP':
      case 'XCUP':
        this.cwd = posix.dirname(this.cwd);
        return this.reply(250, 'OK.');
      case 'MKD':
      case 'XMKD':
        return this.reply(257, `"${this.resolvePath(arg)}" created.`);
      case 'RMD':
      case 'XRMD':
      case 'DELE':
        return this.reply(250, 'OK.');
      case 'TYPE':
      case 'MODE':
      case 'STRU':
        return this.reply(200, 'OK.');
      case 'ALLO':
        return this.reply(202, 'Not needed.');
      case 'REST':
        return this.reply(350, 'Restarting at 0.');
      case 'SIZE':
      case 'MDTM':
        return this.reply(550, 'No such file.');
      case 'ABOR':
        this.dropData();
        return this.reply(226, 'Aborted.');
      case 'PASV':
        return this.enterPassive(false);
      case 'EPSV':
        return this.enterPassive(true);
      case 'PORT':
        return this.setActive(arg);
      case 'LIST':
      case 'NLST':
        return this.sendEmptyListing();
      case 'STOR':
      case 'APPE':
        return this.store(this.resolvePath(arg));
      default:
        return this.reply(502, 'Command not implemented.');
    }
  }

  private dropData(): void {
    if (this.data?.kind === 'passive') this.data.close();
    this.data = null;
  }

  private async enterPassive(extended: boolean): Promise<void> {
    this.dropData();
    const [from, to] = this.opts.passivePorts;
    for (let port = from; port <= to; port++) {
      if (this.busyPorts.has(port)) continue;
      this.busyPorts.add(port);
      const listener = net.createServer();
      const ok = await new Promise<boolean>((resolve) => {
        listener.once('error', () => resolve(false));
        listener.listen(port, this.opts.host, () => resolve(true));
      });
      if (!ok) {
        this.busyPorts.delete(port);
        continue;
      }
      let timer: NodeJS.Timeout | null = null;
      const release = () => {
        if (timer) clearTimeout(timer);
        listener.close();
        this.busyPorts.delete(port);
      };
      const socket = new Promise<net.Socket>((resolve, reject) => {
        timer = setTimeout(() => {
          release();
          reject(new Error('data connection timeout'));
        }, DATA_CONNECT_MS);
        listener.once('connection', (s) => {
          release();
          resolve(s);
        });
      });
      socket.catch(() => undefined);
      this.data = { kind: 'passive', socket, close: release };
      if (extended) return this.reply(229, `Entering Extended Passive Mode (|||${port}|)`);
      const ip = this.opts.passiveHost.split('.').join(',');
      return this.reply(227, `Entering Passive Mode (${ip},${port >> 8},${port & 0xff})`);
    }
    return this.reply(425, 'No passive port available.');
  }

  private setActive(arg: string): void {
    const parts = arg.split(',').map((p) => Number.parseInt(p, 10));
    if (parts.length !== 6 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      this.reply(501, 'Bad PORT argument.');
      return;
    }
    this.dropData();
    const [a, b, c, d, hi, lo] = parts as [number, number, number, number, number, number];
    this.data = { kind: 'active', host: `${a}.${b}.${c}.${d}`, port: hi * 256 + lo };
    this.reply(200, 'PORT OK.');
  }

  private async openData(): Promise<net.Socket | null> {
    const target = this.data;
    this.data = null;
    if (!target) return null;
    try {
      if (target.kind === 'passive') return await target.socket;
      return await new Promise<net.Socket>((resolve, reject) => {
        const s = net.connect(target.port, target.host, () => resolve(s));
        s.once('error', reject);
        s.setTimeout(DATA_CONNECT_MS, () => s.destroy(new Error('connect timeout')));
      });
    } catch {
      return null;
    }
  }

  private async sendEmptyListing(): Promise<void> {
    const pending = this.data;
    if (!pending) return this.reply(425, 'Use PASV or PORT first.');
    this.reply(150, 'Here comes the listing.');
    const s = await this.openData();
    if (!s) return this.reply(425, "Can't open data connection.");
    s.end();
    return this.reply(226, 'Listing done.');
  }

  private async store(path: string): Promise<void> {
    if (!this.data) return this.reply(425, 'Use PASV or PORT first.');
    this.reply(150, 'Ready to receive.');
    const s = await this.openData();
    if (!s) return this.reply(425, "Can't open data connection.");

    const chunks: Buffer[] = [];
    let size = 0;
    const result = await new Promise<'ok' | 'too-large' | 'error'>((resolve) => {
      s.setTimeout(CONTROL_IDLE_MS, () => s.destroy(new Error('data idle')));
      s.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > this.opts.maxFileBytes) {
          s.destroy();
          resolve('too-large');
          return;
        }
        chunks.push(chunk);
      });
      s.once('end', () => resolve('ok'));
      s.once('error', () => resolve('error'));
      s.once('close', () => resolve('ok'));
    });

    if (result === 'too-large') return this.reply(552, 'File too large.');
    if (result === 'error') return this.reply(426, 'Transfer aborted.');
    this.reply(226, 'Transfer complete.');
    const bytes = Buffer.concat(chunks);
    this.opts.log?.(`FTP upload user=${this.user} path=${path} bytes=${bytes.length}`);
    await this.opts.onFile({ user: this.user, path, bytes }).catch((err: Error) => {
      this.opts.log?.(`FTP upload handling failed for ${path}: ${err.message}`);
    });
  }
}
