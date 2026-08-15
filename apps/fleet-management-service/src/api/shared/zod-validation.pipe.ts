/**
 * Zod validation pipe — validates request bodies against a zod schema (same
 * pattern as identity-service; chosen over class-validator to stay consistent
 * with the config + auth packages). On failure throws BadRequest → JSON:API
 * error envelope via GlobalExceptionFilter.
 */
import {
  type ArgumentMetadata,
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import type { ZodType } from 'zod';

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T>) {}

  public transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const first = result.error.issues[0];
      const message = first
        ? `${first.path.join('.') || 'body'}: ${first.message}`
        : 'Validation failed.';
      throw new BadRequestException(message);
    }
    return result.data;
  }
}
