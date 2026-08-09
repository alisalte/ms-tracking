# FleetVision Frontend — CRUD Implementation

Complete enterprise CRUD (Create / Read / Update / Delete) for the Asset Management
modules: **Vehicles, Drivers, Devices, Groups**. Built on the existing Limitless-inspired
design system. No frontend architecture was rebuilt.

## Design principles

1. **Real API, never fake.** Every CUD mutation hits a real REST endpoint via
   `apiPost`/`apiPut`/`apiDelete`. When the backend service is absent (the
   fleet/driver/device-management services don't exist yet), `withMockFallback`
   keeps LIST/DETAIL demoable in dev; CUD mutations surface an honest network
   error in production. No local-only fake mutations.
2. **Typed contracts ready for the backend.** Each entity has `Create*Payload` /
   `Update*Payload` types (`types/asset.types.ts`) + snake_case `*Wire` interfaces
   + `map*(wire)` mappers (`api/asset.api.ts`). When the services ship, only the
   endpoint URLs need confirming — the UI is already wired.
3. **Consistent UX.** One shared form drawer (`AssetFormDrawer`), one confirm
   dialog (`ConfirmDialog`), one toast system (`ToastProvider`), one status-badge
   component — reused across all four entities.

---

## CRUD matrix

| Entity   | LIST | VIEW (drawer) | CREATE | EDIT | DELETE | ASSIGN/UNASSIGN | Other |
|----------|:----:|:------:|:------:|:-----:|:------:|:---------------:|-------|
| Vehicle  | ✅   | ✅     | ✅     | ✅    | ✅     | via edit (deviceId) | status action |
| Driver   | ✅   | ✅     | ✅     | ✅    | ✅     | ✅ hooks (pending backend) | — |
| Device   | ✅   | ✅     | ✅     | ✅    | ✅     | ✅ hooks (pending backend) | Configure¹, Send Command¹ |
| Group    | ✅   | card view | ✅  | ✅    | ✅     | —               | Manage Members¹ |

¹ Surfaced as **disabled + "pending backend" tooltip** per the no-fake rule.

### Additional list features
- **Search**: free-text across identifying fields (plate, VIN, name, serial, email).
- **Filter**: by status (+ type for vehicles/devices).
- **Sort + pagination**: client-side on the already-fetched arrays (mock lists are small).
- **Row action menus**: View / Edit / Delete per row (MUI `<Menu>`).

---

## New shared primitives

### `src/components/feedback/ToastProvider.tsx`
Zero-dependency MUI Snackbar context. `useToast()` → `{ success, error, info, show }`.
The `error` helper accepts an i18n key OR a thrown Error/ApiClientError and extracts
the message via `getApiErrorMessage`. Wired in `App.tsx` between QueryClientProvider
and RouterProvider.

### `src/components/feedback/ConfirmDialog.tsx`
Reusable MUI `<Dialog>` for destructive confirmations (delete). Props: `title`,
`message`, `tone: 'danger'|'default'`, `loading`, `onConfirm`, `onClose`. Renders the
required "This action cannot be undone" body + `[Cancel] [Delete]` actions.

### `src/components/assets/AssetFormDrawer.tsx`
One right-slide-over drawer for create + edit across all four entities. Uses
`react-hook-form` + `zod` + `<Controller>` + `<FormAlert>` (the LoginPage pattern).
Per-entity field sets mirror the domain model (no invented fields). On submit:
calls the matching create/update hook → toast.success → invalidate (via hook) → close.
Errors shown inline + toasted.

---

## API layer — `src/api/asset.api.ts`

### Wire mappers (single source of truth)
`VehicleWire`/`mapVehicle`/`vehicleToWire`, `DriverWire`/..., `DeviceWire`/...,
`GroupWire`/... — snake_case ↔ camelCase translation. Ready for when the services ship.

### LIST/DETAIL hooks (mock-backed with real-API fallback)
`useVehicles`, `useVehicleDetail`, `useDrivers`, `useDriverDetail`, `useDevices`,
`useDeviceDetail`, `useGroups`. Each fetcher: `shouldUseMock() → resolveMock(mockX)`,
else `withMockFallback(realApiGet, mockFallback)`.

### CRUD mutation hooks (real endpoints, typed contracts)

| Hook | Method | Endpoint (pending) |
|------|--------|--------------------|
| `useCreateVehicle` | POST | `/fleet/vehicles` |
| `useUpdateVehicle` | PUT | `/fleet/vehicles/:id` |
| `useDeleteVehicle` | DELETE | `/fleet/vehicles/:id` |
| `useCreateDriver` | POST | `/drivers` |
| `useUpdateDriver` | PUT | `/drivers/:id` |
| `useDeleteDriver` | DELETE | `/drivers/:id` |
| `useAssignDriverVehicle` | POST (204) | `/drivers/:id/assign` |
| `useUnassignDriverVehicle` | POST (204) | `/drivers/:id/unassign` |
| `useCreateDevice` | POST | `/telemetry/devices` |
| `useUpdateDevice` | PUT | `/telemetry/devices/:id` |
| `useDeleteDevice` | DELETE | `/telemetry/devices/:id` |
| `useAssignDeviceVehicle` | POST (204) | `/telemetry/devices/:id/bind` |
| `useUnassignDeviceVehicle` | POST (204) | `/telemetry/devices/:id/unbind` |
| `useCreateGroup` | POST | `/fleet/groups` |
| `useUpdateGroup` | PUT | `/fleet/groups/:id` |
| `useDeleteGroup` | DELETE | `/fleet/groups/:id` |

Each mutation: `onSuccess`/`onSettled` → `qc.invalidateQueries({ queryKey: queryKeys.assets.all })`
(invalidates list + detail caches). The existing `useVehicleStatusAction` now wraps
`useUpdateVehicle` internally (preserved optimistic UX).

### Validation schemas — `src/lib/validation.ts`
`vehicleSchema`, `driverSchema`, `deviceSchema`, `groupSchema` (zod). Messages are
i18n keys. VIN = 17 chars, IMEI = 15 digits, year range, required-field indicators.

### Payload types — `src/types/asset.types.ts`
`CreateVehiclePayload`, `UpdateVehiclePayload` (+ Driver/Device/Group equivalents).
`Update*` is `Partial<Create*>` for PATCH semantics.

---

## Backend dependencies (honest status)

The following services do **not** exist yet. The frontend is fully wired and ready;
when they ship, the CUD operations will work end-to-end without UI changes.

| Service | Endpoints needed |
|---------|-----------------|
| `fleet-management-service` | `/fleet/vehicles` CRUD, `/fleet/groups` CRUD |
| `driver-management-service` | `/drivers` CRUD + assign/unassign |
| `device-management-service` | `/telemetry/devices` CRUD + bind/unbind |
| `device-gateway-service` | `POST /devices/:id/commands` (Configure + Send Command) |

Until then, LIST/DETAIL render from mock data (demoable), and CUD mutations return
network errors (honest, not faked).

---

## Validation results

| Command | Result |
|---------|--------|
| `pnpm typecheck` | ✅ 0 errors |
| `pnpm test` | ✅ 107/107 pass (14 files) |
| `pnpm build` | ✅ builds |
| `pnpm lint` | ✅ 0 web-dashboard rule diagnostics |
