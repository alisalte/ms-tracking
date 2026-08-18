# FleetVision TailAdmin Migration — Phase 3: Auth, Tenant Context & RBAC

**Date:** 2026-08-18
**Scope:** `apps/web-dashboard` authentication/authorization integration with the TailAdmin shell
**Sources of truth:** `docs/tailadmin/PHASE_1_AUDIT.md`, `docs/tailadmin/PHASE_2_IMPLEMENTATION.md`
**Result:** 241/241 unit tests · typecheck ✅ · lint (all touched files) ✅ · production build ✅. Backend services, JWT format, refresh behavior, and token storage are byte-for-byte unchanged.

---

## 1. Authentication architecture (unchanged core, new presentation)

The entire session machinery is the Phase-1 system — nothing was rewritten, only the two presentation surfaces (login page, auth layout) and two leaf states (guard spinner, permission-denied) moved to TailAdmin:

```
LoginPage (TailAdmin, RHF + zod — identical schema)
  └─ useAuthStore.login(email, password, tenant)      [UNCHANGED src/auth/auth.store.ts]
      ├─ saveTenantId(tenant)                          → X-Tenant-Id rides the login call
      ├─ POST /auth/login (auth.api)                   [UNCHANGED wire mapping]
      ├─ saveTokens({access, refresh, tenantUUID})     → localStorage 'fleetvision_tokens'
      └─ GET /auth/me (best-effort)                    → user.permissions[] (JWT claims)

Session keep-alive:
  ├─ axios 401 interceptor: single-flight refresh + retry once     [UNCHANGED api/client.ts]
  ├─ useSilentRefresh (AppLayout): rotate at exp−60s               [UNCHANGED]
  └─ refresh failure → clearTokens() → /login hard redirect        [UNCHANGED]

ProtectedRoute (src/auth/auth.guard.tsx)
  ├─ unauthenticated → Navigate /login?redirect=<path>             [UNCHANGED logic]
  └─ hydrating → Spinner (Tailwind; was MUI CircularProgress)      [markup swap only]
```

Verified behaviors (see §6 tests): login success/failure, `?redirect=` restore, refresh success persists the new pair, refresh failure clears the session, logout revokes server-side + clears storage, session restoration from localStorage.

**Security invariants kept:** tokens stay in `localStorage` under the same keys with the same read/write paths (no new exposure surface); the refresh token is only sent to `POST /auth/refresh`; no auth logic was removed, weakened, or duplicated; the axios interceptor's unauthorized handling is untouched.

## 2. RBAC architecture

```
JWT permissions[] claim (GET /auth/me)
  └─ usePermissions() ── can / canAll / canAny (NEW)     [src/auth/permissions.tsx]
  └─ useCurrentUser()  ── user/tenant/roles/permissions + can/canAll/canAny (NEW, Phase 3)
        │
        ├─ NAV:   filterNavByPermissions()               [unchanged nav.config]
        ├─ ROUTE: <RequirePermission permission | anyOf> [extended, below]
        └─ UI:    <PermissionGate requires any>          [unchanged]
```

- `'*'` tenant-admin wildcard satisfies any requirement (mirrors backend `permissionSatisfies`) — never hardcoded per-page.
- **Route protection now covers every nav-declared permission**: the Phase-1 gap where `/trips` + `/trips/:id` were hidden from nav by `tracking.read` but the routes themselves were open is closed — both now render the **403 PermissionDeniedState** (TailAdmin EmptyState, same copy/keys as before) inside the shell for unauthorized principals.
- `RequirePermission` gained **`anyOf`** (ANY-of semantics); `/assets` now uses `anyOf=[vehicle.read, fleet.read]`, exactly matching its nav visibility rule (previously a fleet-only operator saw the nav item but hit a 403 route — inconsistency fixed).
- **Hiding a menu item is no longer the only gate for any nav-visible page.** Routes without a declared permission in the product's model (`/dashboard /video /alarms /admin /maintenance /account/profile`) remain open **by design** — inventing new permission strings for them would be hardcoding permissions the backend does not define (explicitly forbidden); documented in §7.
- Frontend checks remain UX-only; the backend enforces the same strings on every endpoint.

## 3. Tenant architecture

- Tenant context is unchanged: manual tenant field at login → server-canonicalized UUID (persisted pre-login so `X-Tenant-Id` rides the login request itself) → sent on every axios request and used for WS room scoping. Tenant is never a query/body param.
- `useCurrentUser().tenantId` centralizes tenant reads for the UI; the UserMenu shows the labeled tenant id alongside the identity (no tenant switcher exists — and none was added: switching tenants from the frontend would need backend session re-scoping that identity-service does not expose).
- No frontend tenant handling can bypass backend authorization: every request's tenant claim is validated server-side (identity's tenant-mismatch guard).

## 4. Changed files

| File | Change |
|---|---|
| `src/auth/useCurrentUser.ts` **(new)** | Centralized principal: user / tenantId / roles / permissions / isAuthenticated / isLoading / error / `permissionsPending` + `can`/`canAll`/`canAny` |
| `src/pages/LoginPage.tsx` | Rewritten in TailAdmin (Input/Button/Card/Alert + show/hide password). Identical RHF+zod schema, store calls, `?redirect=` handling, i18n keys, remember-device field |
| `src/layouts/AuthLayout.tsx` | Rewritten in Tailwind (brand panel + form column, responsive, RTL-safe). Hosts the 4 still-MUI auth pages unchanged |
| `src/auth/permissions.tsx` | +`canAny`; `PermissionDeniedState` now renders the TailAdmin EmptyState (same title/description/hint API); evaluation logic untouched |
| `src/components/common/RequirePermission.tsx` | +`anyOf` prop (ANY-of); `permission` optional-but-mutually-exclusive; 403 state unchanged |
| `src/router/index.tsx` | `/trips`, `/trips/:id` gated with `tracking.read`; `/assets` switched to `anyOf` — **the only route-permission changes, both aligned to existing nav declarations** |
| `src/auth/auth.guard.tsx` | Loading markup → Tailwind `Spinner` (logic byte-identical) |
| `src/components/common/ErrorState.tsx` | Ported to TailAdmin (was MUI) — same 401/403/network/generic classification, keys, retry |
| `src/components/layout/UserMenu.tsx` | Tenant line now labeled (`auth.tenantId: <uuid>`) |
| `src/i18n/locales/{en,fa}/common.json` | +`auth.brandHeadline/brandSubline/brandPill.*` (8 keys ×2 locales) for the AuthLayout panel |
| `src/__tests__/auth-rbac.spec.tsx` **(new)** | 19 tests (§6) |

**Not changed:** identity-service, all `src/api/*` (wire contracts, interceptors, refresh), `token.storage.ts`, `useSilentRefresh.ts`, `auth.store.ts`, `AuthProvider`, JWT handling, WS auth, every other page.

## 5. Security considerations

1. **No new token exposure** — same storage keys, same readers (axios interceptor, WS connect, silent refresh), no tokens in React context/state beyond the pre-existing store.
2. **Guards intact** — `ProtectedRoute` untouched logically; `RequirePermission` only *gained* strictness (anyOf parity + two routes gated).
3. **No hardcoded admin access** — every check uses the real `permissions[]` claims; `'*'` wildcard behavior mirrors the backend.
4. **Frontend checks are not a security boundary** (stated in code comments and preserved): backend authorizes every endpoint; route gates exist so users get a proper 403 state instead of broken pages.
5. **Tenant isolation unchanged** — header/claim transport identical; no tenant switching surface added.
6. **401 handling unchanged** — interceptor refresh-and-retry, hard `/login` redirect on failure; `ErrorState` renders the session-expired state for query-level 401s.

## 6. Test results — `auth-rbac.spec.tsx` (19) + suite

| Area | Tests |
|---|---|
| Login page | field rendering with labels; zod validation blocks empty submit; success → store session + canonical tenant + `?redirect=/map` navigation; failure → danger Alert, stays put, store clean |
| Session | refresh success persists new pair to storage; refresh failure clears session+storage; logout revokes (`POST /auth/logout` called) + clears state/storage; ProtectedRoute redirects unauthenticated → `/login`; authenticated renders children |
| RBAC | exact-permission grants; missing permission → 403 "Permission denied" state (copy asserted); `'*'` wildcard grants; `anyOf` grants fleet-only operator (assets parity) |
| Current user / tenant | hook exposes user/tenant/roles/permissions + can/canAll; `permissionsPending` flag while profile loads |
| Error states | ErrorState classifies 401→"Session expired", 403→"Access denied", network→"Connection error", fallback→generic + Retry |
| Nav filtering × routes | covered in `app-shell.spec.tsx` (P2): permission-filtered nav incl. `'*'`; now consistent with route gates |

**Totals: 241/241 unit tests pass** (222 from Phase 2 + 19 new). Existing auth suites (`auth.store.spec`, `auth.api.spec`, `token.storage.spec`, `realtime-auth.spec`) untouched and green. `typecheck` ✅ · `lint` ✅ on all touched files (repo-wide pre-existing failures in untouched files remain, as documented in Phase 2) · `build` ✅.

## 7. Known limitations / deliberate omissions

1. **No "settings" entry in the UserMenu** — no user-settings backend/page exists; Phase-3 scope says expose only supported features (Profile + tenant info + Sign Out are exposed).
2. **MFA page** remains MUI-wired to `NotImplementedError` stubs (backend MFA absent — unchanged from Phase 1; roadmap decision pending).
3. **`/admin`, `/video`, `/alarms`, `/dashboard`, `/maintenance` carry no route permission gates** because the product's permission catalog defines none for those areas; adding invented strings would hardcode authorization the backend doesn't enforce. Flagged for backend owners (Phase-1 R9).
4. **Session-expired notification**: 401-on-query renders the ErrorState; the interceptor's hard redirect happens without a toast (pre-existing behavior, unchanged).
5. **`rememberDevice`** remains cosmetic (schema/parity), as in the MUI original.

**STOP after Phase 3 — Phase 4 (Fleet Dashboard) not started.**
