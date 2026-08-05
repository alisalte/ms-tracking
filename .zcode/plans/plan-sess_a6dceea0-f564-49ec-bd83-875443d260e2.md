# Sprint 2 — Identity & Tenant (MVP) برنامه پیاده‌سازی

## تصمیماتScope (تأییدشده)
- **MVP Login + Tenant**: login، JWT (access+refresh با rotation)، RBAC، API Keys، tenant با RLS، audit
- **argon2 محلی** (m=64MiB, t=3, p=1) — بعداً Vault قابل مهاجرت
- **JWT HS256** با `JWT_SECRET` از env — بعداً RS256/JWKS قابل upgrade
- **Audit با Kafka outbox** اما با relay سبک (همان‌service، polling) چون Debezium/CDC در stack نیست؛ `kafkajs` اضافه می‌شود

خارج از scope MVP (در spec ولی فاز بعدی): MFA (TOTP/WebAuthn)، SSO (OIDC/SAML)، Keycloak، Vault Transit، password reset ایمیلی (Mailhog نیست)، Org hierarchy عمیق، billing/invoice، audit-log-service به‌عنوان service جدا، JWKS/RS256، multi-region replication.

---

## فاز ۰ — آماده‌سازی foundation

### ۰.۱ وابستگی‌ها (به `apps/identity-service/package.json` اضافه می‌شوند)
- `@nestjs/jwt@^10.2.0`, `argon2@^0.41.1`, `cookie-parser@^1.4.7`, `kafkajs@^2.2.4`
- devDeps: `@types/cookie-parser@^1.4.7`
- (Passport استفاده نمی‌شود — guards دستی ساده‌تر و کنترل‌پذیرتر است؛ NestJS DI کافی است)

### ۰.۲ توسعه `identityConfigSchema` (در `apps/identity-service/src/config/identity.config.ts`)
اضافه شدن فیلدها (UPPERCASE):
- `JWT_SECRET: z.string().min(32)` (اجباری، بدون default)
- `JWT_ACCESS_TTL: z.string().default('900s')` (۱۵ دقیقه)
- `JWT_REFRESH_TTL: z.string().default('604800s')` (۷ روز)
- `ARGON2_MEMORY_KIB: z.coerce.number().default(65536)` (64MiB)
- `ARGON2_TIME: z.coerce.number().default(3)`
- `ARGON2_PARALLELISM: z.coerce.number().default(1)`
- `PASSWORD_MIN_LENGTH: z.coerce.number().default(12)`
- `PASSWORD_HISTORY_COUNT: z.coerce.number().default(5)`
- `LOGIN_MAX_ATTEMPTS: z.coerce.number().default(5)`
- `LOGIN_LOCKOUT_SECONDS: z.coerce.number().default(900)`
- `KAFKA_BROKERS: z.string().default('localhost:9092')`
- `KAFKA_AUDIT_TOPIC: z.string().default('fleetvision.audit.audit-entries.events')`

### ۰.۳ به‌روزرسانی `.env` و `.env.example`
- اضافه شدن `JWT_SECRET` (یک مقدار dev با 64 hex chars)، TTLها، ARGON2 پارامترها، KAFKA_BROKERS.

### ۰.۴ به‌روزرسانی تست config (`__tests__/identity.config.spec.ts`)
- افزودن assertion برای فیلدهای جدید و crash-fast روی `JWT_SECRET` گمشده.

---

## فاز ۱ — Database schema (migrations)

مسیر: `apps/identity-service/src/infrastructure/database/migrations/` (JS، knex-style `up(knex)`/`down(knex)`). 

### migration `20260102000000_create_iam_schema.js`
ساخت schema `iam` و جدول‌ها (مطابق `03` §3.4 universal columns + aggregate فیلدها). تمام جدول‌ها `tenant_id NOT NULL` دارند (RLS روی همه فعال می‌شود):

1. **`iam.tenants`** — استثنا: این جدول بالای tenancy است (tenant_id = id خودش برای یکنواختی یا NULL). ستون‌ها: `id UUID PK, name, tier CHECK(STANDARD|PROFESSIONAL|ENTERPRISE), region, status CHECK(PROVISIONING|ACTIVE|SUSPENDED|DEPROVISIONING|DEPROVISIONED), feature_flags JSONB, kek_ref TEXT, root_org_id UUID, version, created_at, updated_at`. RLS ویژه: tenant فقط ردیف خودش، platform services همه.
2. **`iam.users`** — `id, tenant_id, email, username, password_hash (nullable برای SSO-only), status CHECK(ACTIVE|SUSPENDED|DEACTIVATED|LOCKED), display_name, auth_provider DEFAULT 'LOCAL', mfa_enabled DEFAULT false, last_login_at, failed_login_attempts DEFAULT 0, lockout_until, version, created_at, updated_at`. UNIQUE(`tenant_id,email`), UNIQUE(`username`), CHECK status.
3. **`iam.password_history`** — `id, tenant_id, user_id, password_hash, changed_at`.
4. **`iam.roles`** — `id, tenant_id, name, is_system BOOL DEFAULT false, version, created_at, updated_at`. UNIQUE(`tenant_id,name`).
5. **`iam.role_permissions`** — `role_id, permission TEXT`. PK(`role_id,permission`).
6. **`iam.user_roles`** — `id, tenant_id, user_id, role_id, assigned_at`. UNIQUE(`tenant_id,user_id,role_id`).
7. **`iam.organizations`** — `id, tenant_id, parent_org_id, name, code, org_type, status, version, ...`. UNIQUE(`tenant_id,code`). self-FK `parent_org_id`.
8. **`iam.api_keys`** — `id, tenant_id, name, key_hash, key_prefix, scopes JSONB, assigned_user_id, expires_at, last_used_at, status CHECK(ACTIVE|REVOKED), version, ...`.
9. **`iam.refresh_token_families`** — `id, tenant_id, user_id, session_id, status CHECK(ACTIVE|COMPROMISED|EXPIRED|REVOKED), created_at`.
10. **`iam.refresh_tokens`** — `jti TEXT PK, family_id FK, token_hash UNIQUE, issued_at, expires_at, consumed_at, revoked_at, revoked_reason`.
11. **`iam.auth_sessions`** — `id TEXT PK, tenant_id, user_id, status, ip_address INET, user_agent, refresh_token_family_id, issued_at, last_seen_at, absolute_expires_at, revoked_reason, version`.
12. **`audit.audit_entries`** — مطابق `03` §15.1: `id, tenant_id, actor_id, actor_type, action, resource_type, resource_id, permission, outcome, request_id, ip_address, user_agent, before JSONB, after JSONB, seq_no, prev_hash, entry_hash, created_at`. PK(`id,created_at`). **در MVP غیر partitioned** (partitioning پیچیدگی اضافه می‌کند؛ partition بعداً).
13. **`public.event_outbox`** — `id UUID PK, aggregate_type, aggregate_id, event_type, payload JSONB, headers JSONB, created_at, published_at NULL`. index روی `(published_at IS NULL, created_at)`.
14. **seed** — یک tenant پیش‌فرض `STANDARD` + یک کاربر admin با نقش `tenant-admin` (password از env در زمان seed، یا یک اسکریپت seed جدا). نقش‌های سیستم per-tenant (`tenant-admin` با `*`، `viewer` با `*.read`) در زمان ساخت tenant seeding می‌شوند.

### RLS
روی همه جدول‌های tenant-scoped فعال می‌شود؛ policy `USING (tenant_id = current_setting('app.current_tenant_id')::uuid)`. service با `SET LOCAL app.current_tenant_id` قبل از کوئری. tenants جدول policy ویژه. جدول `event_outbox` و `audit.audit_entries` از service role نوشته می‌شوند (RLS برای خواندن).

### نکته درباره partitioning
برای MVP غیر-partitioned می‌گیریم تا پیچیدگی کم شود؛ یک follow-up در گزارش ثبت می‌شود.

---

## فاز ۲ — Domain layer (در `apps/identity-service/src/domain/`)

Aggregates مطابق `02` و IAM module (به‌صورت TypeScript classes از shared-kernel):

- `domain/user/User.ts` (AggregateRoot) — invariants INV-01..05، behaviors: `activate`, `suspend`, `recordFailedLogin`, `recordSuccessfulLogin`, `changeEmail`, `assignRole`, `deactivate`. ID type: `UserId = Brand<string,'UserId'>`.
- `domain/user/Password.ts` (ValueObject) — هش argon2، verify، policy validation (min 12, upper/lower/digit/special)، history check.
- `domain/tenant/Tenant.ts` (AggregateRoot) — lifecycle state machine، tier، quotas.
- `domain/role/Role.ts` (AggregateRoot) — permissions set.
- `domain/apikey/ApiKey.ts` (AggregateRoot) — scopes، expiry، keyPrefix.
- `domain/auth/AuthSession.ts`, `domain/auth/RefreshTokenFamily.ts` (با reuse-detection logic).
- `domain/events.ts` — تعریف event types: `UserCreated`, `UserActivated`, `RoleAssigned`, `TenantProvisioned`, `AuthLoginSucceeded`, `AuthLoginFailed`, `AuthTokenRefreshed`, `ApikeyCreated` و ... (CloudEvents-compatible، از shared-kernel `DomainEvent`).
- `domain/permissions.ts` — کاتالوگ permission به‌عنوان const string union + helper.

---

## فاز ۳ — Application layer (در `apps/identity-service/src/application/`)

Use-caseها (Command handlers) که aggregates را load، اعمال، و ذخیره می‌کنند، eventها را pull کرده و در outbox می‌نویسند:

- `auth/LoginUseCase.ts` — verify password، check lockout، issue tokens، create session، write audit.
- `auth/RefreshTokenUseCase.ts` — rotation + reuse detection.
- `auth/LogoutUseCase.ts` — revoke session + family.
- `users/CreateUserUseCase`, `UpdateUserUseCase`, `AssignRoleUseCase`.
- `tenants/ProvisionTenantUseCase` — create tenant + root org + seed roles + admin user.
- `apikeys/CreateApiKeyUseCase`, `RevokeApiKeyUseCase`.
- هر use-case یک transaction باز می‌کند، aggregate را persist می‌کند، `pullEvents()` را در `event_outbox` insert می‌کند (atomic).

---

## فاز ۴ — Infrastructure layer

### ۴.۱ Repositories (در `infrastructure/persistence/`)
هر کلاس از `BaseRepository<Row>` (یا برای tenant-less جدول‌ها مثل `tenants`، یک نسخه بدون tenant-scope که مستقیم knex می‌زند). قرار دادن:
- `UsersRepository`, `RolesRepository`, `ApiKeysRepository`, `RefreshTokenRepository`, `AuthSessionRepository`, `OrganizationsRepository`, `AuditRepository`, `OutboxRepository`.
- Tenant scoping: `SET LOCAL app.current_tenant_id` در یک knex transaction wrapper (helper جدید `withTenantContext(knex, tenantId, fn)`).

### ۴.۲ Cache facades (در `infrastructure/cache/`)
روی `REDIS_TOKEN`:
- `SessionStore` — Redis Hash برای session فعال + index `session:user:<uid>` برای logout-all + revocation keys.
- `RevocationStore` — `revocation:<jti>` و `revocation:user:<uid>`.
- `RateLimiterStore` — login rate limit (token bucket via Redis INCR).
- `LockoutStore` — `lockout:<uid>`, `failedlogin:<uid>`.

### ۴.۳ Services
- `PasswordHasher` (argon2 wrapper با config params).
- `TokenService` — JWT sign/verify (`@nestjs/jwt` با HS256، claims: iss/sub/aud/exp/iat/jti/tenant_id/tenant_tier/roles/aal/session_id/scope).
- `KafkaOutboxRelay` — worker در background (setInterval یا NestJS Scheduler) که از `event_outbox` rowهای `published_at IS NULL` را می‌خواند، به Kafka می‌فرستد، `published_at` را set می‌کند. idempotent (Kafka producer با event id). در MVP single-instance (no leader election؛ یک فاز برای scale).
- `AuditService` — computes hash chain (SHA-256) و insert در `audit.audit_entries`.

---

## فاز ۵ — API layer (در `apps/identity-service/src/api/`)

### Guards & middleware
- `JwtAuthGuard` — استخراج Bearer، verify، revocation check در Redis، load principal، attach به request + `CorrelationMiddleware.attachPrincipal`.
- `ApiKeyAuthGuard` — استخراج `X-Api-Key`، lookup در Redis/DB، verify argon2 hash، check status/IP.
- `PermissionsGuard` — `@RequirePermissions('iam.user.create')` decorator + guard که roles→permissions را resolve.
- `TenantContextMiddleware` — از JWT `tenant_id`، `SET LOCAL` در یک request-scoped تراکنش (یا per-query). **tenant_id هرگز از body نمی‌آید** (INV-I02).

### Controllers (base path `/api/v1`)
- `AuthController` (`/auth`): `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-all`, `GET /auth/me`, `GET /auth/sessions`, `DELETE /auth/sessions/:id`.
- `ApiKeysController` (`/auth/api-keys`): `GET`, `POST` (returns plaintext once), `DELETE /:id`, `POST /:id/rotate`.
- `UsersController` (`/iam/users`): `GET`, `POST`, `GET /:id`, `PUT /:id`, `PATCH /:id/status`, `POST /:id/roles`, `GET /:id/permissions`.
- `RolesController` (`/iam/roles`): `GET`, `POST`, `PUT /:id`, `DELETE /:id`.
- `OrganizationsController` (`/iam/organizations`): `GET`, `POST`, `GET /:id`, org hierarchy.
- `TenantsController` (`/tenants`): `POST` (provision)، `GET /:id`، `:suspend`, `:reactivate`. self: `/tenant` (`GET /tenant`, `/tenant/usage`).
- `AuditController` (`/audit/entries`): `GET` query (simplified).

### DTOs
با zod یا class-validator — config فعلی class-validator ندارد. **تصمیم: از zod استفاده می‌کنیم** (هم‌راستا با config package، dep کمتر). یک `ZodValidationPipe` سبک ساخته می‌شود. DTOها به‌عنوان zod schema تعریف می‌شوند. `tenant_id` هرگز در schema نیست (INV-I02).

### Wiring در `app.module.ts`
افزودن feature modules: `AuthModule`, `UsersModule`, `TenantsModule`, `ApiKeysModule`, `AuditModule`. ثبت `JwtModule.registerAsync`, cookie-parser در main، validation pipe.

---

## فاز ۶ — Error mapping
افزایش `GlobalExceptionFilter` در `packages/web` برای شناخت `DomainError` از shared-kernel (نگاشت `code` → `HttpStatusByCode`). auth errors به `401` generic map می‌شوند (no oracle).

---

## فاز ۷ — Tests (hermetic، بدون infra — مطابق CI)
- **Unit (domain)**: aggregate invariants، refresh reuse detection، password policy، tenant state machine.
- **Unit (application)**: use-caseها با mocked repositories.
- **Unit (guards/services)**: JwtAuthGuard، PermissionsGuard، TokenService (sign/verify)، PasswordHasher (argon2 در test واقعی چون native است و بدون DB کار می‌کند)، rate limiter logic.
- **Unit (validation)**: DTO schemas (reject tenant_id در body).
- **Config test**: فیلدهای جدید.
- مکان: `src/__tests__/**/*.spec.ts` با `@jest/globals`. برای integration test واقعی (Postgres/Redis/Kafka) — یک فاز بعدی، چون CI سرویس ندارد؛ در گزارش ذکر می‌شود.

---

## ترتیب اجرا (وابستگی‌ها)
۱. فاز ۰ → ۲. فاز ۱ (migrations، شامل seed script) → ۳. فاز ۲ (domain) → ۴. فاز ۴ (infra: hasher، token، repos، stores) → ۵. فاز ۳ (application، استفاده از infra) → ۶. فاز ۵ (API) → ۷. فاز ۶ (errors) → ۸. فاز ۷ (tests به‌موازات هر فاز) → ۹. اجرای محلی: `pnpm stack:up` + migration + seed + curl login.

## اعتبارسنجی نهایی
- `pnpm lint && pnpm typecheck && pnpm build && pnpm test` همه سبز.
- اجرای محلی با Docker stack: bootstrap identity-service، migration خودکار، seed یک tenant+admin، سپس `curl POST /api/v1/auth/login` توکن برمی‌گرداند و `curl GET /api/v1/auth/me` با توکن کار می‌کند.
- گزارش نهایی: scope، آنچه ساخته شد، phantom/deferred items (MFA، SSO، Vault، partitioning، integration tests، multi-region)، و نحوه اجرا.

## محدودیت‌ها / نکات
- **هیچ commit/push** بدون اجازه شما. همه تغییرات staged.
- اگر به مشکل پیش‌بینی‌نشده بربخورم (مثلاً argon2 native build در Windows، RLS پیچیدگی، Kafka producer setup) متوقف می‌شوم و می‌گویم.
- این یک sprint بزرگ است؛ فازبندی را طی چند مرحله با checkpoint پیش می‌برم. می‌توانم پس از هر فاز تأیید بگیرم یا یک‌جا تا آخر بروم — پیش‌فرضم یک‌جا تا آخر با checkpoint در صورت خطاست.