/**
 * Tailwind UI primitives barrel — TailAdmin-style building blocks.
 *
 * These coexist with the legacy MUI components (`components/ui/`). Pages still
 * on MUI import from `@/components/ui`; the shell, dashboard, and newly-ported
 * pages import from here. As more pages migrate, this barrel becomes the
 * single presentation-layer entry point.
 */
export { Avatar } from './Avatar';
export type { AvatarProps } from './Avatar';
export { Badge } from './Badge';
export type { BadgeProps } from './Badge';
export { Button } from './Button';
export type { ButtonProps } from './Button';
export { Card, CardHeader } from './Card';
export type { CardProps } from './Card';
export { IconButton } from './IconButton';
export type { IconButtonProps } from './IconButton';
export { StatusBadge } from './StatusBadge';
export type { StatusBadgeProps } from './StatusBadge';
export { Tooltip } from './Tooltip';
export type { TooltipProps } from './Tooltip';
