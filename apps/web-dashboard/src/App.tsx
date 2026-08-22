import { queryClient } from '@/api/query-client';
import { AuthProvider } from '@/auth/auth.context';
import { ToastProvider } from '@/components/feedback/ToastProvider';
import { router } from '@/router';
import { ThemeRegistry } from '@/theme/ThemeRegistry';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';

/**
 * Root application component.
 *
 * Provider hierarchy (outermost → innermost):
 * 1. ThemeRegistry — color mode (Tailwind `dark:` class) + document direction
 * 2. AuthProvider — Zustand auth store hydration from localStorage
 * 3. QueryClientProvider — TanStack Query for server state
 * 4. ToastProvider — app-wide success/error notifications
 * 5. RouterProvider — React Router navigation
 */
export default function App() {
  return (
    <ThemeRegistry>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </QueryClientProvider>
      </AuthProvider>
    </ThemeRegistry>
  );
}
