/**
 * Orthophoto pipeline: ECW upload → ecw2tiff → GDAL COG (EPSG:3857) → publish.
 *
 * Conversions run one at a time as low-priority child processes. The previous
 * layer stays live until the new COG is ready, then is replaced atomically.
 * Tiles are rendered on demand from the COG and cached on disk.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import type { OnModuleInit } from '@nestjs/common';
import {
  boundsFromExtent,
  isValidTile,
  nativeZoom,
  signTileToken,
  tileBounds,
  tileTokenExpiry,
} from '../domain/orthophoto.js';
import {
  OrthophotoBusyError,
  type OrthophotoRepository,
  type OrthophotoRow,
} from '../infrastructure/persistence/orthophoto.repository.js';

export { OrthophotoBusyError };
export class OrthophotoInputError extends Error {}
export class OrthophotoDiskFullError extends Error {}

export type CommandRunner = (cmd: string, args: readonly string[]) => Promise<string>;

const CONVERT_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const TILE_TIMEOUT_MS = 30_000;
const MAX_TILE_RENDERS = 4;
/** Room needed for the decoded intermediate + COG, as a multiple of the ECW. */
const FREE_SPACE_FACTOR = 6;
/** How far below native resolution the layer is still drawn. */
const ZOOM_RANGE = 10;
const GDAL_ENV = { ...process.env, GDAL_PAM_ENABLED: 'NO' };

function run(cmd: string, args: readonly string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...args], {
      env: GDAL_ENV,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => {
      if (out.length < 4_000_000) out += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      err = (err + d.toString()).slice(-2000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `${cmd} exited with ${code ?? 'signal'}`));
    });
  });
}

const defaultConvertRunner: CommandRunner = (cmd, args) => run(cmd, args, CONVERT_TIMEOUT_MS);
const defaultTileRunner: CommandRunner = (cmd, args) => run(cmd, args, TILE_TIMEOUT_MS);

export interface OrthophotoView {
  readonly id: string;
  readonly status: OrthophotoRow['status'];
  readonly originalName: string;
  readonly error: string | null;
  readonly createdAt: string;
  readonly readyAt: string | null;
  readonly sizeBytes: number | null;
  readonly bounds: [number, number, number, number] | null;
  readonly minZoom: number | null;
  readonly maxZoom: number | null;
  readonly tileUrl: string | null;
}

export class OrthophotoService implements OnModuleInit {
  private queue: Promise<void> = Promise.resolve();
  private readonly renders = new Map<string, Promise<string | null>>();
  private activeRenders = 0;
  private readonly renderWaiters: Array<() => void> = [];
  private readonly convert: CommandRunner;
  private readonly renderCmd: CommandRunner;

  constructor(
    private readonly deps: {
      repo: OrthophotoRepository;
      dataDir: string;
      tileSecret: string;
      convert?: CommandRunner;
      render?: CommandRunner;
    },
  ) {
    this.convert = deps.convert ?? defaultConvertRunner;
    this.renderCmd = deps.render ?? defaultTileRunner;
  }

  public async onModuleInit(): Promise<void> {
    await mkdir(this.incomingDir, { recursive: true });
    await this.deps.repo.failInterrupted('interrupted');
    for (const name of await readdir(this.incomingDir)) {
      await rm(join(this.incomingDir, name), { force: true, recursive: true });
    }
  }

  private get incomingDir(): string {
    return join(this.deps.dataDir, 'incoming');
  }

  private jobDir(tenantId: string, id: string): string {
    return join(this.deps.dataDir, tenantId, id);
  }

  /** Validate the upload, record it and queue the conversion. Returns the new id. */
  public async accept(input: {
    tenantId: string;
    userId: string | null;
    path: string;
    originalName: string;
    size: number;
  }): Promise<string> {
    try {
      if (!input.originalName.toLowerCase().endsWith('.ecw')) {
        throw new OrthophotoInputError('Only .ecw files are accepted');
      }
      const fs = await statfs(this.deps.dataDir);
      if (fs.bavail * fs.bsize < input.size * FREE_SPACE_FACTOR) {
        throw new OrthophotoDiskFullError('Not enough free disk space to convert this file');
      }
      const id = await this.deps.repo.createProcessing({
        tenantId: input.tenantId,
        originalName: input.originalName,
        createdBy: input.userId,
      });
      const dir = this.jobDir(input.tenantId, id);
      await mkdir(dir, { recursive: true });
      await rename(input.path, join(dir, 'source.ecw'));
      this.queue = this.queue.then(() => this.process(input.tenantId, id));
      return id;
    } catch (err) {
      await rm(input.path, { force: true });
      throw err;
    }
  }

  private async process(tenantId: string, id: string): Promise<void> {
    const dir = this.jobDir(tenantId, id);
    const source = join(dir, 'source.ecw');
    const decoded = join(dir, 'decoded.tif');
    const cog = join(dir, 'cog.tif');
    try {
      await this.convert('nice', [
        '-n',
        '10',
        'ecw2tiff',
        '--threads',
        '3',
        '--compress',
        'jpeg:92',
        source,
        decoded,
      ]);
      await this.convert('nice', [
        '-n',
        '10',
        'gdal_translate',
        '-q',
        '-of',
        'COG',
        '-co',
        'TILING_SCHEME=GoogleMapsCompatible',
        '-co',
        'COMPRESS=WEBP',
        '-co',
        'QUALITY=85',
        '-co',
        'NUM_THREADS=3',
        '-co',
        'BIGTIFF=IF_SAFER',
        decoded,
        cog,
      ]);
      const info = JSON.parse(await this.convert('gdalinfo', ['-json', cog])) as {
        wgs84Extent?: unknown;
        geoTransform?: number[];
      };
      const bounds = boundsFromExtent(info.wgs84Extent);
      const pixel = info.geoTransform?.[1];
      if (!bounds || !pixel) throw new Error('Converted file has no usable georeferencing');
      const maxZoom = nativeZoom(pixel);
      const { size } = await stat(cog);
      const replaced = await this.deps.repo.activate(tenantId, id, {
        ...bounds,
        minZoom: Math.max(0, maxZoom - ZOOM_RANGE),
        maxZoom,
        cogBytes: size,
      });
      await rm(source, { force: true });
      await rm(decoded, { force: true });
      for (const oldId of replaced) {
        await rm(this.jobDir(tenantId, oldId), { force: true, recursive: true });
      }
    } catch (err) {
      await rm(dir, { force: true, recursive: true });
      await this.deps.repo
        .markFailed(tenantId, id, err instanceof Error ? err.message.slice(0, 1000) : 'failed')
        .catch(() => undefined);
    }
  }

  public async list(tenantId: string): Promise<OrthophotoView[]> {
    const rows = await this.deps.repo.listForTenant(tenantId);
    return rows.map((row) => this.toView(row));
  }

  public async remove(tenantId: string): Promise<void> {
    for (const id of await this.deps.repo.deleteReady(tenantId)) {
      await rm(this.jobDir(tenantId, id), { force: true, recursive: true });
    }
  }

  private toView(row: OrthophotoRow): OrthophotoView {
    const ready = row.status === 'ready';
    let tileUrl: string | null = null;
    if (ready) {
      const token = signTileToken(this.deps.tileSecret, {
        tenantId: row.tenant_id,
        orthophotoId: row.id,
        exp: tileTokenExpiry(Math.floor(Date.now() / 1000)),
      });
      tileUrl = `/api/v1/map/orthophoto/tiles/${token}/{z}/{x}/{y}.webp`;
    }
    return {
      id: row.id,
      status: row.status,
      originalName: row.original_name,
      error: row.error,
      createdAt: new Date(row.created_at).toISOString(),
      readyAt: row.ready_at ? new Date(row.ready_at).toISOString() : null,
      sizeBytes: row.cog_bytes === null ? null : Number(row.cog_bytes),
      bounds: ready
        ? [
            row.min_lng as number,
            row.min_lat as number,
            row.max_lng as number,
            row.max_lat as number,
          ]
        : null,
      minZoom: row.min_zoom,
      maxZoom: row.max_zoom,
      tileUrl,
    };
  }

  /** Path of the rendered tile, or null when the tile has no imagery. */
  public async tile(
    tenantId: string,
    id: string,
    z: number,
    x: number,
    y: number,
  ): Promise<string | null> {
    if (!isValidTile(z, x, y)) return null;
    const dir = this.jobDir(tenantId, id);
    const cog = join(dir, 'cog.tif');
    if (!existsSync(cog)) return null;
    const file = join(dir, 'tiles', String(z), String(x), `${y}.webp`);
    if (existsSync(file)) return file;
    const pending = this.renders.get(file);
    if (pending) return pending;
    const job = this.render(cog, file, z, x, y).finally(() => this.renders.delete(file));
    this.renders.set(file, job);
    return job;
  }

  private async render(
    cog: string,
    file: string,
    z: number,
    x: number,
    y: number,
  ): Promise<string | null> {
    await this.acquireRender();
    const tmp = `${file}.${process.pid}.tmp.webp`;
    try {
      const b = tileBounds(z, x, y);
      await mkdir(join(file, '..'), { recursive: true });
      await this.renderCmd('gdal_translate', [
        '-q',
        '-of',
        'WEBP',
        '-co',
        'QUALITY=80',
        '-projwin',
        String(b.minX),
        String(b.maxY),
        String(b.maxX),
        String(b.minY),
        '-outsize',
        '256',
        '256',
        '-r',
        'bilinear',
        cog,
        tmp,
      ]);
      await rename(tmp, file);
      return file;
    } catch (err) {
      await rm(tmp, { force: true });
      if (err instanceof Error && /outside/i.test(err.message)) return null;
      throw err;
    } finally {
      this.releaseRender();
    }
  }

  private async acquireRender(): Promise<void> {
    if (this.activeRenders < MAX_TILE_RENDERS) {
      this.activeRenders += 1;
      return;
    }
    await new Promise<void>((resolve) => this.renderWaiters.push(resolve));
  }

  private releaseRender(): void {
    const next = this.renderWaiters.shift();
    if (next) next();
    else this.activeRenders -= 1;
  }
}
