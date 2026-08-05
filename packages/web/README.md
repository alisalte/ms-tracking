# @fleetvision/web

HTTP cross-cutting primitives (Codebase Architecture §8) — the seed of the response pipeline:

- **`GlobalExceptionFilter`** — maps thrown errors to the JSON:API `errors[]` envelope. `HttpException` keeps its status; everything else becomes a canonical `INTERNAL_ERROR` 500. Later sprints add the domain-error → HTTP mapping and PII redaction.
- **`RequestIdInterceptor`** — the seed interceptor (the correlation headers themselves are set by the observability middleware). Later sprints add response shaping here.
- **`errorDocument(...)`** + `JsonApiError`/`JsonApiErrorDocument` — the canonical error wire shape (API_Design.md §8.1).

## Usage

```ts
import { GlobalExceptionFilter, RequestIdInterceptor } from '@fleetvision/web';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor());
  await app.listen(cfg.port);
}
```
