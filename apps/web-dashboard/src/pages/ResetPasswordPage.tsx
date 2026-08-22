import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';
import type { z } from 'zod';

import { resetPassword as resetPasswordApi } from '@/api/auth.api';
import { PasswordTextField } from '@/components/form/PasswordTextField';
import { Alert, Button, Card, IconButton } from '@/components/tailwind-ui';
import { isNotImplemented } from '@/lib/errors';
import { passwordWithConfirmSchema } from '@/lib/validation';

/**
 * ResetPasswordPage — TailAdmin one-time-token password reset (Phase 3 port).
 *
 * The token arrives as `?token=` in the URL (from the reset email). It is valid
 * for 30 minutes and single-use (AUTH-BR-09). Without a token the page shows a
 * guidance message instead of the form.
 */
const resetSchema = passwordWithConfirmSchema;
type ResetForm = z.infer<typeof resetSchema>;

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetForm>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: '', confirmPassword: '' },
    mode: 'onSubmit',
  });

  const onSubmit = async (values: ResetForm) => {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      await resetPasswordApi({ token: token ?? '', password: values.password });
      navigate('/login', { replace: true });
    } catch (err) {
      setSubmitError(
        isNotImplemented(err) ? t('auth.featureNotAvailable') : (err as Error).message,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // No token → guide the user back to the forgot-password flow.
  if (!token) {
    return (
      <Card className="w-full p-6 sm:p-8">
        <Alert variant="warning" className="mb-4">
          {t('auth.resetTokenMissing')}
        </Alert>
        <p className="mb-4 text-sm text-gray-500 dark:text-graydark-600">
          {t('auth.resetTokenMissingHelp')}
        </p>
        <Button fullWidth onClick={() => navigate('/forgot-password')}>
          {t('auth.forgotPassword')}
        </Button>
      </Card>
    );
  }

  return (
    <Card className="w-full p-6 sm:p-8">
      {/* Heading */}
      <div className="mb-1 flex items-center gap-2">
        <IconButton
          size="sm"
          variant="ghost"
          onClick={() => navigate('/login')}
          aria-label={t('common.backToLogin')}
        >
          <ArrowLeft size={16} aria-hidden />
        </IconButton>
        <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-white">
          {t('auth.resetPassword')}
        </h1>
      </div>
      <p className="mb-6 text-sm text-gray-500 dark:text-graydark-600">
        {t('auth.resetPasswordHelp')}
      </p>

      {/* Server error (invalid/expired token, backend gap, network). */}
      {submitError && (
        <Alert variant="danger" className="mb-4">
          {submitError}
        </Alert>
      )}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        <Controller
          name="password"
          control={control}
          render={({ field }) => (
            <PasswordTextField
              {...field}
              value={field.value ?? ''}
              id="password"
              label={t('auth.newPassword')}
              autoCompleteValue="new-password"
              autoFocus
              disabled={isSubmitting}
              error={errors.password ? t(errors.password.message ?? '') : null}
              hint={errors.password ? null : t('auth.passwordPolicy')}
            />
          )}
        />
        <Controller
          name="confirmPassword"
          control={control}
          render={({ field }) => (
            <PasswordTextField
              {...field}
              value={field.value ?? ''}
              id="confirmPassword"
              label={t('auth.confirmPassword')}
              autoCompleteValue="new-password"
              disabled={isSubmitting}
              error={errors.confirmPassword ? t(errors.confirmPassword.message ?? '') : null}
            />
          )}
        />

        <Button type="submit" size="lg" fullWidth disabled={isSubmitting} loading={isSubmitting}>
          {isSubmitting ? t('common.submitting') : t('auth.resetPassword')}
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
