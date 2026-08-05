/**
 * Zod validation pipe — validates request bodies against a zod schema. Chosen
 * over class-validator to stay consistent with the config package (also zod)
 * and avoid pulling class-transformer/decorator metadata into the graph.
 *
 * On validation failure, throws a BadRequest with the first issue — the
 * GlobalExceptionFilter maps it to the JSON:API error envelope.
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
