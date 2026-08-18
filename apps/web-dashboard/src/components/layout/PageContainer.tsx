import type { ReactNode } from 'react';

/**
 * PageContainer — standard page wrapper for TailAdmin pages (Tailwind).
 *
 * New/migrated pages compose their content inside this container to get a
 * consistent content width and vertical rhythm without re-deriving spacing
 * per page. Full-bleed pages (Map, Video Wall) skip it by design.
 */
export function PageContainer({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto flex w-full max-w-[1600px] flex-col gap-5 ${className}`}>
      {children}
    </div>
  );
}
