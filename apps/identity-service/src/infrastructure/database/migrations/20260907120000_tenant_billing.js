/**
 * Tenant billing: unit prices on licenses, invoices, and dashboard aggregates.
 *
 * Amounts are integer IRR (rial). One non-void invoice per license period.
 *
 * RLS matches iam.tenants: platform GUC or own tenant_id.
 *
 * @param {import('knex').Knex} knex
 */

const PLATFORM_PREDICATE = "current_setting('app.is_platform', true) = 'true'";
const TENANT_PREDICATE =
  "tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid";
const PREDICATE = `(${PLATFORM_PREDICATE}) OR (${TENANT_PREDICATE})`;

const PLAN_PRICES = {
  TRIAL: {
    base_price: 0,
    unit_price_users: 0,
    unit_price_vehicles: 0,
    unit_price_devices: 0,
    unit_price_drivers: 0,
    unit_price_storage_gib: 0,
    unit_price_download_gib: 0,
  },
  STANDARD: {
    base_price: 15_000_000,
    unit_price_users: 250_000,
    unit_price_vehicles: 100_000,
    unit_price_devices: 60_000,
    unit_price_drivers: 80_000,
    unit_price_storage_gib: 25_000,
    unit_price_download_gib: 10_000,
  },
  PROFESSIONAL: {
    base_price: 45_000_000,
    unit_price_users: 200_000,
    unit_price_vehicles: 80_000,
    unit_price_devices: 45_000,
    unit_price_drivers: 70_000,
    unit_price_storage_gib: 20_000,
    unit_price_download_gib: 8_000,
  },
  ENTERPRISE: {
    base_price: 120_000_000,
    unit_price_users: 150_000,
    unit_price_vehicles: 50_000,
    unit_price_devices: 30_000,
    unit_price_drivers: 50_000,
    unit_price_storage_gib: 15_000,
    unit_price_download_gib: 5_000,
  },
  CUSTOM: {
    base_price: 15_000_000,
    unit_price_users: 250_000,
    unit_price_vehicles: 100_000,
    unit_price_devices: 60_000,
    unit_price_drivers: 80_000,
    unit_price_storage_gib: 25_000,
    unit_price_download_gib: 10_000,
  },
};

export async function up(knex) {
  await knex.schema.withSchema('iam').alterTable('tenant_licenses', (t) => {
    t.text('currency').notNullable().defaultTo('IRR');
    t.bigInteger('base_price').notNullable().defaultTo(0);
    t.bigInteger('unit_price_users').notNullable().defaultTo(0);
    t.bigInteger('unit_price_vehicles').notNullable().defaultTo(0);
    t.bigInteger('unit_price_devices').notNullable().defaultTo(0);
    t.bigInteger('unit_price_drivers').notNullable().defaultTo(0);
    t.bigInteger('unit_price_storage_gib').notNullable().defaultTo(0);
    t.bigInteger('unit_price_download_gib').notNullable().defaultTo(0);
  });

  const licenses = await knex('iam.tenant_licenses').select('tenant_id', 'plan_code');
  for (const row of licenses) {
    const prices = PLAN_PRICES[row.plan_code] ?? PLAN_PRICES.STANDARD;
    await knex('iam.tenant_licenses').where({ tenant_id: row.tenant_id }).update(prices);
  }

  await knex.schema.withSchema('iam').createTable('tenant_invoices', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('iam.tenants').onDelete('CASCADE');
    t.text('invoice_number').notNullable();
    t.text('status').notNullable().checkIn(['ISSUED', 'PAID', 'VOID', 'OVERDUE']);
    t.timestamp('period_start', { useTz: true }).notNullable();
    t.timestamp('period_end', { useTz: true }).notNullable();
    t.timestamp('due_date', { useTz: true }).notNullable();
    t.text('currency').notNullable().defaultTo('IRR');
    t.bigInteger('subtotal').notNullable();
    t.decimal('tax_rate', 6, 4).notNullable().defaultTo(0);
    t.bigInteger('tax_amount').notNullable().defaultTo(0);
    t.bigInteger('total_amount').notNullable();
    t.text('notes').nullable();
    t.timestamp('generated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('paid_at', { useTz: true }).nullable();
    t.timestamp('voided_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['invoice_number'], { indexName: 'iam_tenant_invoices_number_unique' });
    t.index(['tenant_id', 'generated_at'], 'iam_tenant_invoices_tenant_idx');
    t.index(['status'], 'iam_tenant_invoices_status_idx');
  });

  await knex.raw(`
    CREATE UNIQUE INDEX iam_tenant_invoices_period_unique
    ON iam.tenant_invoices (tenant_id, period_start, period_end)
    WHERE status <> 'VOID'
  `);

  await knex.schema.withSchema('iam').createTable('tenant_invoice_lines', (t) => {
    t.uuid('id').primary();
    t.uuid('invoice_id')
      .notNullable()
      .references('id')
      .inTable('iam.tenant_invoices')
      .onDelete('CASCADE');
    t.integer('line_no').notNullable();
    t.text('type').notNullable();
    t.text('description').notNullable();
    t.decimal('quantity', 18, 4).notNullable();
    t.bigInteger('unit_price').notNullable();
    t.bigInteger('total_amount').notNullable();
    t.unique(['invoice_id', 'line_no'], { indexName: 'iam_tenant_invoice_lines_no_unique' });
  });

  await knex.raw('ALTER TABLE iam.tenant_invoices ENABLE ROW LEVEL SECURITY');
  await knex.raw('DROP POLICY IF EXISTS tenant_invoices_isolation ON iam.tenant_invoices');
  await knex.raw(
    `CREATE POLICY tenant_invoices_isolation ON iam.tenant_invoices USING (${PREDICATE}) WITH CHECK (${PREDICATE})`,
  );

  await knex.raw('ALTER TABLE iam.tenant_invoice_lines ENABLE ROW LEVEL SECURITY');
  await knex.raw(
    'DROP POLICY IF EXISTS tenant_invoice_lines_isolation ON iam.tenant_invoice_lines',
  );
  await knex.raw(`
    CREATE POLICY tenant_invoice_lines_isolation ON iam.tenant_invoice_lines
    USING (
      ${PLATFORM_PREDICATE}
      OR invoice_id IN (
        SELECT id FROM iam.tenant_invoices
        WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
      )
    )
    WITH CHECK (
      ${PLATFORM_PREDICATE}
      OR invoice_id IN (
        SELECT id FROM iam.tenant_invoices
        WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
      )
    )
  `);

  await knex.raw(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON iam.tenant_invoices TO fleetvision_app, fleetvision_platform',
  );
  await knex.raw(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON iam.tenant_invoice_lines TO fleetvision_app, fleetvision_platform',
  );
  await knex.raw(
    'GRANT SELECT, INSERT, UPDATE ON iam.tenant_licenses TO fleetvision_app, fleetvision_platform',
  );
}

export async function down(knex) {
  await knex.raw(
    'DROP POLICY IF EXISTS tenant_invoice_lines_isolation ON iam.tenant_invoice_lines',
  );
  await knex.raw('DROP POLICY IF EXISTS tenant_invoices_isolation ON iam.tenant_invoices');
  await knex.schema.withSchema('iam').dropTableIfExists('tenant_invoice_lines');
  await knex.schema.withSchema('iam').dropTableIfExists('tenant_invoices');
  await knex.schema.withSchema('iam').alterTable('tenant_licenses', (t) => {
    t.dropColumn('currency');
    t.dropColumn('base_price');
    t.dropColumn('unit_price_users');
    t.dropColumn('unit_price_vehicles');
    t.dropColumn('unit_price_devices');
    t.dropColumn('unit_price_drivers');
    t.dropColumn('unit_price_storage_gib');
    t.dropColumn('unit_price_download_gib');
  });
}
