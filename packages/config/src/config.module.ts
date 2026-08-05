/**
 * ConfigModule — NestJS DynamicModule that validates the environment against a
 * service-supplied zod schema and provides a typed `ConfigService`.
 *
 * Usage:
 *   ConfigModule.forRoot({ schema: identityConfigSchema, serviceName: 'identity-service' })
 *
 * On invalid config the module throws synchronously during Nest bootstrap — the
 * process exits non-zero, surfacing the misconfiguration immediately (§13).
 */
import { type DynamicModule, Global, Module, type Provider } from '@nestjs/common';
import type { ZodError, ZodObject, ZodRawShape, ZodType, ZodTypeDef } from 'zod';
import { type BaseConfig, baseConfigSchema } from './base-config.js';
import { TypedConfigService } from './config.service.js';

export const CONFIG_TOKEN = 'FLEETVISION_CONFIG';

export interface ConfigModuleOptions<T extends BaseConfig> {
  /**
   * Service-specific zod schema. Conventionally the result of
   * `baseConfigSchema.merge(z.object({ ...serviceKeys }))`; we merge it against
   * the base here regardless, so passing the bare service extension works too.
   * The input type is left loose (`any`) because base keys carry defaults that
   * make them optional on input but required on output — zod's default-inference
   * would otherwise trip strict input/output variance.
   */
  // biome-ignore lint/suspicious/noExplicitAny: zod input type is intentionally loose to accommodate default-bearing base keys
  schema: ZodType<T, ZodTypeDef, any>;
  /** Logical service name (also used in logs/traces/event source). */
  serviceName: string;
  /** Override the env source (defaults to process.env). Useful in tests. */
  env?: NodeJS.ProcessEnv;
}

@Global()
@Module({})
export class ConfigModule {
  public static forRoot<T extends BaseConfig>(options: ConfigModuleOptions<T>): DynamicModule {
    const env = options.env ?? process.env;

    // Parse + validate. Merge base defaults with the service schema so every
    // service inherits port/logLevel/environment from baseConfigSchema. Services
    // conventionally pass `baseConfigSchema.merge(z.object({ ... }))`; merging
    // again here is idempotent (zod `.merge` overrides duplicate keys), so both
    // a bare extension object and a pre-merged schema work.
    const merged = baseConfigSchema.merge(options.schema as unknown as ZodObject<ZodRawShape>);
    const parseResult = merged.safeParse({
      ...env,
      serviceName: options.serviceName,
    });

    if (!parseResult.success) {
      // Crash fast: print a readable error then throw (Nest will exit non-zero).
      const formatted = formatZodError(parseResult.error);
      // eslint-disable-next-line no-console
      console.error(`[config] Invalid configuration — refusing to start.\n${formatted}`);
      throw new Error(`Invalid configuration:\n${formatted}`);
    }

    const validated = parseResult.data as T;
    const provider: Provider = {
      provide: CONFIG_TOKEN,
      useValue: validated,
    };
    const configServiceProvider: Provider = {
      provide: TypedConfigService,
      useFactory: () => new TypedConfigService(validated),
    };

    return {
      module: ConfigModule,
      global: true,
      providers: [provider, configServiceProvider],
      exports: [CONFIG_TOKEN, TypedConfigService],
    };
  }
}

/** Render a ZodError as a human-readable, line-per-issue string. */
function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `  • ${path}: ${issue.message}`;
    })
    .join('\n');
}
