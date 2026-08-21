/**
 * Tailwind UI primitives barrel — TailAdmin-style building blocks.
 *
 * These coexist with the legacy MUI components (`components/ui/`). Pages still
 * on MUI import from `@/components/ui`; the shell, dashboard, and newly-ported
 * pages import from here. As more pages migrate, this barrel becomes the
 * single presentation-layer entry point.
 */
export { Alert } from './Alert';
export type { AlertProps, AlertVariant } from './Alert';
export { Avatar } from './Avatar';
export type { AvatarProps } from './Avatar';
export { Badge } from './Badge';
export type { BadgeProps } from './Badge';
export { Button } from './Button';
export type { ButtonProps } from './Button';
export { Card, CardHeader } from './Card';
export type { CardProps } from './Card';
export { Checkbox } from './Checkbox';
export type { CheckboxProps } from './Checkbox';
export { DataTable } from './DataTable';
export type { Column as TableColumn, Align as TableAlign } from './DataTable';
export { Drawer } from './Drawer';
export type { DrawerProps } from './Drawer';
export { Dropdown, DropdownItem } from './Dropdown';
export type { DropdownProps, DropdownItemProps } from './Dropdown';
export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';
export { IconButton } from './IconButton';
export type { IconButtonProps } from './IconButton';
export { Input } from './Input';
export type { InputProps } from './Input';
export { Modal } from './Modal';
export type { ModalProps } from './Modal';
export { LoadMoreButton, NumberedPagination } from './Pagination';
export { Select } from './Select';
export type { SelectProps, SelectOption } from './Select';
export { Spinner } from './Spinner';
export type { SpinnerProps } from './Spinner';
export { Skeleton } from './Skeleton';
export type { SkeletonProps } from './Skeleton';
export { StatusBadge } from './StatusBadge';
export type { StatusBadgeProps } from './StatusBadge';
export { Switch } from './Switch';
export type { SwitchProps } from './Switch';
export { Table, THead, TBody, TFoot, TH, TD } from './Table';
export type { TableProps, THProps, TDProps } from './Table';
export { Tabs } from './Tabs';
export type { TabItem } from './Tabs';
export { Textarea } from './Textarea';
export type { TextareaProps } from './Textarea';
export { Toolbar } from './Toolbar';
export type { ToolbarProps } from './Toolbar';
export { Tooltip } from './Tooltip';
export type { TooltipProps } from './Tooltip';
