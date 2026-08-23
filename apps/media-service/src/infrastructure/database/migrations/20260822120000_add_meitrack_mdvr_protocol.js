/**
 * Extend media.video_channels.protocol with MEITRACK_MDVR — the Meitrack MDVR
 * binary 0x12 media plane (MDVR GPRS Protocol V2.0 §3.16) used by the
 * mdvr-streamer live-video path (A9A dialback → NAL reassembly → MPEG-TS).
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.raw(
    "ALTER TABLE media.video_channels DROP CONSTRAINT video_channels_protocol_check",
  );
  await knex.raw(
    "ALTER TABLE media.video_channels ADD CONSTRAINT video_channels_protocol_check " +
      "CHECK (protocol IN ('JT1078', 'RTSP', 'RTMP', 'WEBRTC', 'MEITRACK_MDVR'))",
  );
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.raw(
    "ALTER TABLE media.video_channels DROP CONSTRAINT video_channels_protocol_check",
  );
  await knex.raw(
    "ALTER TABLE media.video_channels ADD CONSTRAINT video_channels_protocol_check " +
      "CHECK (protocol IN ('JT1078', 'RTSP', 'RTMP', 'WEBRTC'))",
  );
}
