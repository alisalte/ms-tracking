/**
 * Principal — re-exported from @fleetvision/auth. The canonical interface lives
 * in the shared auth package so every service speaks the same Principal shape.
 * Identity's existing imports (`getPrincipal`, `Principal`) keep resolving.
 */
export { type Principal, getPrincipal } from '@fleetvision/auth';
