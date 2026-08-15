/**
 * Avatar — circular initials/image token (Tailwind).
 *
 * Brand-tinted fallback. Sizes match TailAdmin's avatar scale.
 */
export interface AvatarProps {
  src?: string;
  alt?: string;
  /** Initials when no image (falls back to first letter of `name`). */
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = {
  xs: 'size-6 text-[0.65rem]',
  sm: 'size-8 text-xs',
  md: 'size-9 text-sm',
  lg: 'size-12 text-base',
};

function initials(name?: string): string | undefined {
  if (!name) return undefined;
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]?.charAt(0).toUpperCase();
  return (parts[0]?.charAt(0) + parts[parts.length - 1]?.charAt(0)).toUpperCase();
}

export function Avatar({ src, alt, name, size = 'sm', className = '' }: AvatarProps) {
  const cls = [
    'inline-flex items-center justify-center rounded-full font-semibold shrink-0',
    'bg-brand-500 text-white overflow-hidden',
    SIZES[size],
    className,
  ]
    .filter(Boolean)
    .join(' ');

  if (src) {
    return <img src={src} alt={alt ?? name ?? ''} className={cls} />;
  }
  return <span className={cls}>{initials(name) ?? '?'}</span>;
}
