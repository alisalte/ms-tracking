/**
 * One live camera channel per (tenant, device, logical channel).
 *
 * Binding an MDVR device to a vehicle registers its default cameras, and
 * re-binding the same device registered them again — nothing stopped the second
 * INSERT. A device bound four times put eight tiles on the video wall for two
 * physical cameras.
 *
 * Existing duplicates are RETIRED, not deleted, so stream sessions and evidence
 * rows still pointing at them keep their foreign key; the channel list queries
 * already filter DECOMMISSIONED out. The oldest row of each camera survives.
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  // channel_id breaks ties so exactly one row per camera survives — two rows
  // sharing a created_at would otherwise both live on and fail the index below.
  await knex.raw(`
    UPDATE media.video_channels c
       SET status = 'DECOMMISSIONED', updated_at = now()
     WHERE c.status <> 'DECOMMISSIONED'
       AND c.device_id IS NOT NULL
       AND c.logical_channel IS NOT NULL
       AND EXISTS (
             SELECT 1
               FROM media.video_channels k
              WHERE k.tenant_id = c.tenant_id
                AND k.device_id = c.device_id
                AND k.logical_channel = c.logical_channel
                AND k.status <> 'DECOMMISSIONED'
                AND (k.created_at, k.channel_id) < (c.created_at, c.channel_id)
           )
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX ux_channels_tenant_device_logical
        ON media.video_channels (tenant_id, device_id, logical_channel)
     WHERE status <> 'DECOMMISSIONED'
       AND device_id IS NOT NULL
       AND logical_channel IS NOT NULL
  `);
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS media.ux_channels_tenant_device_logical');
}
