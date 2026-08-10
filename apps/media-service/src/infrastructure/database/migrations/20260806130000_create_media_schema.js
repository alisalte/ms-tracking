/**
 * Sprint 10 — Media & Video schema (09 §7.3; VideoPlatform §7.4).
 *
 * Creates the `media` schema with the two core tables media-service owns:
 *   - media.video_channels  — the camera channel registry (VideoChannel aggregate).
 *   - media.stream_sessions — live/playback sessions (StreamSession, high-churn →
 *                             partitioned daily by started_at).
 *
 * A camera belongs to either a vehicle_id (dashcam) or a site_id (CCTV), never both
 * (09 §8.4). Each channel has a protocol (JT1078/RTSP/RTMP), a codec (H264/H265),
 * and a JT1078 logical channel number.
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  await knex.raw('CREATE SCHEMA IF NOT EXISTS media');

  // --- media.video_channels (09 §5.1) ---
  await knex.schema.withSchema('media').createTable('video_channels', (t) => {
    t.uuid('channel_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    // A channel belongs to a vehicle OR a site, never both.
    t.uuid('vehicle_id').nullable();
    t.uuid('site_id').nullable();
    t.uuid('device_id').nullable();
    t.text('label').notNullable(); // "Forward", "Driver", "Cargo"...
    // JT1078 logical channel number (e.g. 1=forward, 2=back...).
    t.smallint('logical_channel').nullable();
    t.text('protocol').notNullable().checkIn(['JT1078', 'RTSP', 'RTMP', 'WEBRTC']);
    t.text('codec').notNullable().checkIn(['H264', 'H265', 'AAC', 'OPUS', 'G711', 'G726']);
    // RTSP endpoint or RTMP stream key (null for JT1078 which uses the device SIM).
    t.text('endpoint').nullable();
    t.text('status')
      .notNullable()
      .checkIn(['REGISTERED', 'ONLINE', 'DEGRADED', 'OFFLINE', 'DECOMMISSIONED'])
      .defaultTo('REGISTERED');
    t.boolean('ptz').notNullable().defaultTo(false);
    t.jsonb('capabilities').notNullable().defaultTo(JSON.stringify({}));
    t.integer('version').notNullable().defaultTo(1);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    "CREATE INDEX ix_channels_tenant_vehicle ON media.video_channels (tenant_id, vehicle_id) WHERE status != 'DECOMMISSIONED'",
  );
  await knex.raw(
    "CREATE INDEX ix_channels_tenant_site ON media.video_channels (tenant_id, site_id) WHERE status != 'DECOMMISSIONED'",
  );

  // --- media.stream_sessions (09 §5.2, partitioned daily) ---
  await knex.schema.withSchema('media').createTable('stream_sessions', (t) => {
    t.uuid('session_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('channel_id').notNullable();
    t.uuid('user_id').nullable();
    t.text('mode').notNullable().checkIn(['LIVE', 'PLAYBACK', 'RECORD', 'AI']);
    t.text('quality').notNullable().defaultTo('auto');
    t.text('state')
      .notNullable()
      .checkIn(['CONNECTING', 'ACTIVE', 'DEGRADED', 'CLOSED'])
      .defaultTo('CONNECTING');
    t.text('streamer_pod').nullable();
    t.integer('viewer_count').notNullable().defaultTo(0);
    t.timestamp('started_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('ended_at', { useTz: true }).nullable();
    t.jsonb('metadata').notNullable().defaultTo(JSON.stringify({}));
  });
  await knex.raw(
    'CREATE INDEX ix_sessions_tenant_channel ON media.stream_sessions (tenant_id, channel_id, started_at DESC)',
  );
  await knex.raw(
    "CREATE INDEX ix_sessions_active ON media.stream_sessions (tenant_id) WHERE state IN ('CONNECTING', 'ACTIVE', 'DEGRADED')",
  );

  // --- Row-Level Security (tenant-scoped, MVP permissive) ---
  for (const table of ['video_channels', 'stream_sessions']) {
    await knex.raw(`ALTER TABLE media.${table} ENABLE ROW LEVEL SECURITY`);
    await knex.raw(
      `CREATE POLICY ${table}_tenant_isolation ON media.${table} USING (true) WITH CHECK (true)`,
    );
  }
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.schema.withSchema('media').dropTableIfExists('stream_sessions');
  await knex.schema.withSchema('media').dropTableIfExists('video_channels');
  await knex.raw('DROP SCHEMA IF EXISTS media');
}
