/**
 * `@Public()` — marks a route as exempt from the global authentication guard.
 * The shared `@fleetvision/auth` CompositeAuthGuard + PermissionsGuard check
 * for this metadata (`IS_PUBLIC_KEY`) and skip. Kept in `@fleetvision/web` so
 * lightweight HTTP packages (health) can declare public routes without a hard
 * dependency on the full auth package.
 */
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
