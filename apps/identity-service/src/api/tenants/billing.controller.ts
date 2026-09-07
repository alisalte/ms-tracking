/**
 * Platform billing — invoices, dashboard, and reports for SaaS-Ops.
 */
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { TenantBillingUseCase } from '../../application/tenants/tenant-billing.use-case.js';
import { type GenerateInvoiceDto, generateInvoiceSchema } from '../auth/auth.dto.js';
import { RequirePermissions } from '../shared/permissions.guard.js';
import { ZodValidationPipe } from '../shared/zod-validation.pipe.js';

@Controller('api/v1')
export class BillingController {
  constructor(private readonly billing: TenantBillingUseCase) {}

  @Get('billing/dashboard')
  @RequirePermissions('billing.tenant.manage')
  public async dashboard() {
    return { data: await this.billing.dashboard() };
  }

  @Get('billing/report')
  @RequirePermissions('billing.tenant.manage')
  public async report() {
    return { data: await this.billing.report() };
  }

  @Get('billing/invoices')
  @RequirePermissions('billing.tenant.manage')
  public async listAll() {
    const rows = await this.billing.list();
    return { data: rows, meta: { total: rows.length } };
  }

  @Get('billing/invoices/:id')
  @RequirePermissions('billing.tenant.manage')
  public async get(@Param('id') id: string) {
    return { data: await this.billing.get(id) };
  }

  @Post('billing/invoices/:id/pay')
  @RequirePermissions('billing.tenant.manage')
  public async pay(@Param('id') id: string) {
    return { data: await this.billing.markPaid(id) };
  }

  @Post('billing/invoices/:id/void')
  @RequirePermissions('billing.tenant.manage')
  public async voidInvoice(@Param('id') id: string) {
    return { data: await this.billing.void(id) };
  }

  @Get('tenants/:id/invoices')
  @RequirePermissions('billing.tenant.manage')
  public async listForTenant(@Param('id') id: string) {
    const rows = await this.billing.list(id);
    return { data: rows, meta: { total: rows.length } };
  }

  @Post('tenants/:id/invoices')
  @RequirePermissions('billing.tenant.manage')
  public async generate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(generateInvoiceSchema)) body: GenerateInvoiceDto,
  ) {
    const invoice = await this.billing.generate(id, {
      dueDays: body.due_days,
      taxRate: body.tax_rate,
      notes: body.notes,
    });
    return { data: invoice };
  }
}
