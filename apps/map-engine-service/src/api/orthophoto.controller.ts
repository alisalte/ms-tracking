/**
 * Drone orthophoto API.
 *
 *   GET    /map/orthophoto                     — this tenant's layer + any job (maps.read)
 *   POST   /map/orthophoto  (multipart `file`) — upload an ECW, 202 + job id (maps.write)
 *   DELETE /map/orthophoto                     — remove the published layer (maps.write)
 *   GET    /map/orthophoto/tiles/:token/z/x/y  — tile; authorised by the signed token
 */
import { CurrentTenant, CurrentUser, Public, RequirePermissions } from '@fleetvision/auth';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  OrthophotoBusyError,
  OrthophotoDiskFullError,
  OrthophotoInputError,
  type OrthophotoService,
} from '../application/orthophoto-service.js';
import type { MapEngineConfig } from '../config/map-engine.config.js';
import { verifyTileToken } from '../domain/orthophoto.js';
import { MAP_ENGINE_CONFIG, ORTHOPHOTO_SERVICE } from './tokens.js';

const DATA_DIR = process.env.ORTHOPHOTO_DATA_DIR ?? '/data/orthophotos';
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

interface UploadedEcw {
  readonly path: string;
  readonly originalname: string;
  readonly size: number;
}

interface TileResponse {
  status(code: number): TileResponse;
  setHeader(name: string, value: string): void;
  end(): void;
  sendFile(path: string): void;
}

@Controller('map/orthophoto')
export class OrthophotoController {
  constructor(
    @Inject(ORTHOPHOTO_SERVICE) private readonly service: OrthophotoService,
    @Inject(MAP_ENGINE_CONFIG) private readonly config: MapEngineConfig,
  ) {}

  @Get()
  @RequirePermissions('maps.read')
  public async list(@CurrentTenant() tenantId: string) {
    return { items: await this.service.list(tenantId) };
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('maps.write')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: `${DATA_DIR}/incoming`,
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  public async upload(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: { userId?: string } | undefined,
    @UploadedFile() file: UploadedEcw | undefined,
  ) {
    if (!file) throw new HttpException('file is required', HttpStatus.BAD_REQUEST);
    try {
      const id = await this.service.accept({
        tenantId,
        userId: user?.userId ?? null,
        path: file.path,
        // multer decodes multipart filenames as latin1; restore UTF-8 (Persian names).
        originalName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
        size: file.size,
      });
      return { id };
    } catch (err) {
      if (err instanceof OrthophotoInputError) {
        throw new HttpException(err.message, HttpStatus.BAD_REQUEST);
      }
      if (err instanceof OrthophotoBusyError) {
        throw new HttpException('A conversion is already running', HttpStatus.CONFLICT);
      }
      if (err instanceof OrthophotoDiskFullError) {
        throw new HttpException(err.message, 507);
      }
      throw err;
    }
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('maps.write')
  public async remove(@CurrentTenant() tenantId: string): Promise<void> {
    await this.service.remove(tenantId);
  }

  @Public()
  @Get('tiles/:token/:z/:x/:y.webp')
  public async tile(
    @Param('token') token: string,
    @Param('z') z: string,
    @Param('x') x: string,
    @Param('y') y: string,
    @Res() res: TileResponse,
  ): Promise<void> {
    const claims = verifyTileToken(this.config.JWT_SECRET, token, Math.floor(Date.now() / 1000));
    if (!claims) throw new HttpException('Invalid tile token', HttpStatus.FORBIDDEN);
    const file = await this.service.tile(
      claims.tenantId,
      claims.orthophotoId,
      Number(z),
      Number(x),
      Number(y),
    );
    if (!file) {
      res.status(HttpStatus.NO_CONTENT).end();
      return;
    }
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Content-Type', 'image/webp');
    res.sendFile(file);
  }
}

export const ORTHOPHOTO_DATA_DIR = DATA_DIR;
