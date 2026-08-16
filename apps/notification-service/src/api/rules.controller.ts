import {
  type PageRequestDto,
  RequirePermissions,
  type UuidParamDto,
  ZodValidationPipe,
  pageRequestSchema,
  uuidParamSchema,
} from '@fleetvision/auth';
import { getPrincipal } from '@fleetvision/auth';
import { type Page, decodeCursor } from '@fleetvision/shared-kernel';
/**
 * Rules controller — alarm rule CRUD. Base /api/v1/notification/rules.
 * All routes require JWT + notification.rule.* permissions.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AlarmRule } from '../domain/index.js';
import { AlarmRuleNotFoundError } from '../domain/index.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime for reflect-metadata.
import { AlarmRuleRepository } from '../infrastructure/persistence/alarm-rule.repository.js';
import {
  type CreateRuleDto,
  type UpdateRuleDto,
  conditionsForType,
  createRuleSchema,
  updateRuleSchema,
} from './notification.dto.js';

@Controller('api/v1/notification/rules')
export class RulesController {
  constructor(private readonly rules: AlarmRuleRepository) {}

  @Get()
  @RequirePermissions('notification.rule.read')
  public async list(
    @Query(new ZodValidationPipe(pageRequestSchema)) page: PageRequestDto,
    @Req() req: Request,
  ): Promise<Page<unknown>> {
    const p = getPrincipal(req);
    const cursor = page.cursor
      ? (() => {
          const c = decodeCursor(page.cursor);
          return { createdAt: c.value, id: c.id ?? '' };
        })()
      : undefined;
    return this.rules.listPage(p.tenantId, page.limit, cursor);
  }

  @Get(':id')
  @RequirePermissions('notification.rule.read')
  public async get(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const rule = await this.rules.findById(p.tenantId, params.id);
    if (!rule) throw new AlarmRuleNotFoundError();
    return { data: rule };
  }

  @Post()
  @RequirePermissions('notification.rule.create')
  public async create(
    @Body(new ZodValidationPipe(createRuleSchema)) body: CreateRuleDto,
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const rule = AlarmRule.create(undefined, {
      tenantId: p.tenantId,
      name: body.name,
      type: body.type,
      severity: body.severity,
      enabled: true,
      entityType: 'vehicle',
      entityId: body.entity_id ?? null,
      conditions: body.conditions,
      cooldownSec: body.cooldown_sec,
      dedupWindowSec: body.dedup_window_sec,
      repeatPolicy: body.repeat_policy,
    });
    await this.rules.create(rule);
    return { data: { id: rule.id } };
  }

  @Put(':id')
  @RequirePermissions('notification.rule.update')
  public async update(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Body(new ZodValidationPipe(updateRuleSchema)) body: UpdateRuleDto,
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const rule = await this.rules.findById(p.tenantId, params.id);
    if (!rule) throw new AlarmRuleNotFoundError();
    if (body.conditions !== undefined) {
      // Type-aware condition validation (Part 28) — the update keeps the rule's
      // type, so validate the new conditions against THAT type.
      try {
        conditionsForType(rule.type, body.conditions);
      } catch (err) {
        throw new BadRequestException(`Invalid rule conditions: ${(err as Error).message}`);
      }
    }
    if (body.name !== undefined) rule.name = body.name;
    if (body.severity !== undefined) rule.severity = body.severity;
    if (body.conditions !== undefined) rule.conditions = body.conditions;
    if (body.cooldown_sec !== undefined) rule.cooldownSec = body.cooldown_sec;
    if (body.dedup_window_sec !== undefined) rule.dedupWindowSec = body.dedup_window_sec;
    if (body.repeat_policy !== undefined) rule.repeatPolicy = body.repeat_policy;
    await this.rules.update(rule);
    return { data: { id: rule.id } };
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('notification.rule.update')
  public async enable(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Req() req: Request,
  ): Promise<void> {
    const p = getPrincipal(req);
    const rule = await this.rules.findById(p.tenantId, params.id);
    if (!rule) throw new AlarmRuleNotFoundError();
    rule.enable();
    await this.rules.update(rule);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('notification.rule.update')
  public async disable(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Req() req: Request,
  ): Promise<void> {
    const p = getPrincipal(req);
    const rule = await this.rules.findById(p.tenantId, params.id);
    if (!rule) throw new AlarmRuleNotFoundError();
    rule.disable();
    await this.rules.update(rule);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('notification.rule.delete')
  public async delete(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Req() req: Request,
  ): Promise<void> {
    const p = getPrincipal(req);
    await this.rules.delete(p.tenantId, params.id);
  }
}
