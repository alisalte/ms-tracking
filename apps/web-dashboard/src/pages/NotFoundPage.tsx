import { Compass } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { Button, EmptyState } from '@/components/tailwind-ui';

/**
 * NotFoundPage — proper 404 screen (replaces the old inline router element).
 *
 * Rendered inside the authenticated AppLayout shell for any unmatched path
 * (`path: '*'`). Built on the shared EmptyState + Button primitives with full
 * en/fa i18n and a primary "back to dashboard" action — the new `notFound.*`
 * keys carry English `defaultValue`s until the locale JSON lands.
 */
export function NotFoundPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <EmptyState
        icon={<Compass aria-hidden />}
        title={t('notFound.title', { defaultValue: '404 — Page not found' })}
        description={t('notFound.description', {
          defaultValue: "The page you're looking for doesn't exist or has been moved.",
        })}
        action={
          <Button variant="primary" onClick={() => navigate('/')}>
            {t('notFound.backToDashboard', { defaultValue: 'Back to dashboard' })}
          </Button>
        }
      />
    </div>
  );
}
