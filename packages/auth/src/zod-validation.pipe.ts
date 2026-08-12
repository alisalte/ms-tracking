/**
 * Zod validation pipe — validates request bodies/params/query against a zod
 * schema. Chosen over class-validator to stay consistent with the config package
 * (also zod) and avoid pulling class-transformer/decorator metadata into the graph.
 *
 * On validation failure, throws a BadRequestException carrying ALL zod issues on
 * its response (under `zodIssues`); the GlobalExceptionFilter emits one JSON:API
 * error per issue with a `source.pointer`, so clients can highlight every
 * offending field at once. Works on body, query, and params (NestJS applies the
 * pipe to whichever argument it decorates).
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
      const issues = result.error.issues.map((i) => ({
        message: i.message,
        path: i.path,
      }));
      // The first issue's message is the top-level detail; the full set is attached
      // for the exception filter to expand into per-field JSON:API errors.
      const first = result.error.issues[0];
      const message = first
        ? `${first.path.join('.') || 'value'}: ${first.message}`
        : 'Validation failed.';
      throw new BadRequestException({ message, zodIssues: issues });
    }
    return result.data;
  }
}
