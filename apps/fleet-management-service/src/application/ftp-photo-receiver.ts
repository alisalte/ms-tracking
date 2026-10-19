/**
 * FtpPhotoReceiver — runs the FTP alarm-photo receiver and provisions units.
 *
 * `enableForDevice` sends B64 (MDVR GPRS Protocol V2.0 §3.45) with this
 * platform's FTP host, port and the device's derived credentials, after
 * which the unit uploads its event snapshots on its own. Non-fatal at boot:
 * a port clash logs and leaves the rest of the service running.
 */
import { lookup } from 'node:dns/promises';
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

import type { FleetManagementConfig } from '../config/fleet-management.config.js';
import { FtpPhotoServer } from '../infrastructure/ftp/ftp-photo-server.js';
import type { DeviceRepository } from '../infrastructure/persistence/device.repository.js';
import type { EvidenceCaptureRepository } from '../infrastructure/persistence/evidence-capture.repository.js';
import type { DeviceCommandService } from './device-command.service.js';
import { FtpPhotoIngest, ftpPasswordFor } from './ftp-photo-ingest.js';
import type { ActorContext } from './service-context.js';

export class FtpPhotoReceiver implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('FtpPhotoReceiver');
  private readonly ingest: FtpPhotoIngest;
  private server: FtpPhotoServer | null = null;

  constructor(
    private readonly cfg: FleetManagementConfig,
    /** Resolved MDVR public host — the fallback for FLEET_FTP_PUBLIC_HOST. */
    private readonly mdvrPublicHost: string,
    private readonly devices: DeviceRepository,
    evidence: EvidenceCaptureRepository,
    private readonly commands: DeviceCommandService,
  ) {
    this.ingest = new FtpPhotoIngest({
      secret: cfg.FLEET_FTP_SECRET,
      devices,
      evidence,
      compression: {
        maxEdge: cfg.FLEET_EVIDENCE_PHOTO_MAX_EDGE,
        quality: cfg.FLEET_EVIDENCE_PHOTO_QUALITY,
      },
    });
  }

  private get publicHost(): string {
    return (this.cfg.FLEET_FTP_PUBLIC_HOST || this.mdvrPublicHost).trim();
  }

  public get enabled(): boolean {
    return Boolean(this.cfg.FLEET_FTP_SECRET && this.publicHost);
  }

  public async onApplicationBootstrap(): Promise<void> {
    if (!this.cfg.FLEET_FTP_SECRET) {
      this.logger.log('FTP photo receiver disabled (FLEET_FTP_SECRET empty).');
      return;
    }
    if (!this.publicHost) {
      this.logger.warn('FTP photo receiver disabled: no FLEET_FTP_PUBLIC_HOST / MDVR_PUBLIC_HOST.');
      return;
    }
    const [from, to] = this.cfg.FLEET_FTP_PASV_PORTS.split('-').map(Number) as [number, number];
    try {
      const passiveHost = (await lookup(this.publicHost, { family: 4 })).address;
      const server = new FtpPhotoServer({
        host: '0.0.0.0',
        port: this.cfg.FLEET_FTP_PORT,
        passiveHost,
        passivePorts: [from, to],
        maxFileBytes: this.cfg.FLEET_FTP_MAX_FILE_BYTES,
        authenticate: this.ingest.authenticate,
        onFile: this.ingest.onFile,
        log: (m) => this.logger.log(m),
      });
      await server.start();
      this.server = server;
      this.logger.log(
        `FTP photo receiver on :${this.cfg.FLEET_FTP_PORT} — units upload to ` +
          `${this.publicHost}:${this.cfg.FLEET_FTP_PUBLIC_PORT} (PASV ${passiveHost} ${from}-${to}).`,
      );
    } catch (err) {
      this.logger.error(`FTP photo receiver failed to start: ${(err as Error).message}`);
    }
  }

  public async onApplicationShutdown(): Promise<void> {
    this.ingest.stop();
    await this.server?.stop();
    this.server = null;
  }

  /** Point one unit's B64 photo upload at this platform. */
  public async enableForDevice(ctx: ActorContext, deviceId: string) {
    if (!this.enabled) {
      throw new BadRequestException(
        'FTP photo upload is not configured on the platform (FLEET_FTP_SECRET / public host).',
      );
    }
    const device = await this.devices.findById(ctx.tenantId, deviceId);
    if (!device) throw new NotFoundException('Device not found.');
    return this.commands.create(ctx, deviceId, {
      commandCode: 'B64',
      params: {
        mode: '1',
        username: device.imei,
        password: ftpPasswordFor(this.cfg.FLEET_FTP_SECRET, device.imei),
        host: this.publicHost,
        port: String(this.cfg.FLEET_FTP_PUBLIC_PORT),
        path: '/',
      },
    });
  }
}
