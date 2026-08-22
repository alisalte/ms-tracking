import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useNavigate } from 'react-router';
import { z } from 'zod';

import { forgotPassword as forgotPasswordApi } from '@/api/auth.api';
import { Alert, Button, Card, IconButton, Input } from '@/components/tailwind-ui';
import { isNotImplemented } from '@/lib/errors';
import { emailSchema } from '@/lib/validation';

/**
 * ForgotPasswordPage — TailAdmin password-reset request (Phase 3 port).
 *
 * Security note (ARR SEC-3, no user-enumeration oracle): regardless of whether
 * the email exists — or whether the backend is implemented — the UI shows the
 * SAME success message after submit. It never reveals account existence.
 */
const forgotSchema = z.object({ email: emailSchema });
type ForgotForm = z.infer<typeof forgotSchema>;

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotForm>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: '' },
    mode: 'onSubmit',
  });

  const onSubmit = async (values: ForgotForm) => {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      await forgotPasswordApi({ email: values.email });
      setSent(true);
    } catch (err) {
      // Even when not implemented, show the success state to avoid an oracle.
      if (isNotImplemented(err)) {
        setSent(true);
      } else {
        setSubmitError((err as Error).message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (sent) {
    return (
      <Card className="w-full p-6 text-center sm:p-8">
        <MailCheck size={48} className="mx-auto text-brand-500" aria-hidden />
        <h1 className="mt-4 mb-1 text-2xl font-extrabold tracking-tight text-gray-900 dark:text-white">
          {t('auth.resetLinkSentTitle')}
        </h1>
        <p className="mb-6 text-sm text-gray-500 dark:text-graydark-600">
          {t('auth.resetLinkSentBody')}
        </p>
        <Button variant="primary" fullWidth onClick={() => navigate('/login')}>
          {t('common.backToLogin')}
        </Button>
      </Card>
    );
  }

  return (
    <Card className="w-full p-6 sm:p-8">
      {/* Heading */}
      <div className="mb-2 flex items-center gap-2">
        <IconButton
          size="sm"
          variant="ghost"
          onClick={() => navigate('/login')}
          aria-label={t('common.backToLogin')}
        >
          <ArrowLeft size={16} aria-hidden />
        </IconButton>
        <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-white">
          {t('auth.forgotPassword')}
        </h1>
      </div>

      <p className="mb-6 text-sm text-gray-500 dark:text-graydark-600">
        {t('auth.forgotPasswordHelp')}
      </p>

      {/* Server error (network — never account-existence). */}
      {submitError && (
        <Alert variant="danger" className="mb-4">
          {submitError}
        </Alert>
      )}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        <Controller
          name="email"
          control={control}
          render={({ field }) => (
            <Input
              {...field}
              value={field.value ?? ''}
              id="email"
              type="email"
              label={t('auth.email')}
              autoComplete="email"
              autoFocus
              disabled={isSubmitting}
              error={errors.email ? t(errors.email.message ?? '') : null}
            />
          )}
        />

        <Button type="submit" size="lg" fullWidth disabled={isSubmitting} loading={isSubmitting}>
          {isSubmitting ? t('common.submitting') : t('auth.sendResetLink')}
        </Button>

        <p className="text-center">
          <RouterLink
            to="/login"
            className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            {t('common.backToLogin')}
          </RouterLink>
        </p>
      </form>
    </Card>
  );
}
