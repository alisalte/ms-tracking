/**
 * Rows a delivered photo may still fill. SKIPPED_COOLDOWN is included: the
 * cooldown only spares the GPRS D00 pull, but the unit still uploads (FTP) or
 * stores a photo for every alarm, so those rows must not stay photo-less.
 */
export const PHOTO_ATTACHABLE_STATUSES = [
  'PENDING',
  'FETCHING',
  'PHOTO_FAILED',
  'SKIPPED_COOLDOWN',
];
