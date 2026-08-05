/**
 * Password hashing service — Argon2id with env-driven parameters
 * (Authentication.md §6.9: m=64MiB, t=3, p=1). The MVP runs argon2 locally;
 * a later security sprint migrates to Vault Transit by reference.
 *
 * The hash string produced includes the algorithm + params + salt, so verify
 * is param-independent (a hash made with different params still verifies).
 */
import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

export interface PasswordHasherConfig {
  readonly memoryKib: number;
  readonly time: number;
  readonly parallelism: number;
}

@Injectable()
export class PasswordHasher {
  private readonly options: argon2.Options;

  constructor(config: PasswordHasherConfig) {
    this.options = {
      type: argon2.argon2id,
      memoryCost: config.memoryKib,
      timeCost: config.time,
      parallelism: config.parallelism,
    };
  }

  /** Hash a plaintext password. Returns the argon2-encoded string. */
  public async hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, this.options);
  }

  /** Verify a plaintext against a stored hash. Constant-time within argon2. */
  public async verify(hash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plaintext);
    } catch {
      // Malformed hash — treat as a failed verification (no oracle).
      return false;
    }
  }
}
