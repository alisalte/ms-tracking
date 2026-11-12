/**
 * Keep byte-for-byte compatible with apps/reporting-service/src/infrastructure/crypto/secret-box.ts
 * (same REPORT_SECRETS_KEY, same v1 format): notification-service only ever DECRYPTS
 * what reporting-service's tenant-admin endpoint encrypted.
 *
 * SecretBox — AES-256-GCM for small secrets at rest (tenant SMTP passwords).
 * Key: REPORT_SECRETS_KEY, base64 of 32 random bytes. Without a key the box is
 * unavailable and callers must refuse to store secrets.
 * Format: v1:<iv>:<tag>:<ciphertext> (base64 parts).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class SecretBox {
  private readonly key: Buffer | null;

  constructor(keyBase64: string | undefined) {
    if (!keyBase64) {
      this.key = null;
      return;
    }
    const key = Buffer.from(keyBase64, 'base64');
    if (key.length !== 32) throw new Error('REPORT_SECRETS_KEY must be base64 of 32 bytes');
    this.key = key;
  }

  public get available(): boolean {
    return this.key !== null;
  }

  public encrypt(plain: string): string {
    if (!this.key) throw new Error('REPORT_SECRETS_KEY is not configured');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [
      'v1',
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      ct.toString('base64'),
    ].join(':');
  }

  public decrypt(payload: string): string {
    if (!this.key) throw new Error('REPORT_SECRETS_KEY is not configured');
    const [version, iv, tag, ct] = payload.split(':');
    if (version !== 'v1' || !iv || !tag || !ct) throw new Error('Unsupported secret format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString(
      'utf8',
    );
  }
}
