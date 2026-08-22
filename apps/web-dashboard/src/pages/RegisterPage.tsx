import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useNavigate } from 'react-router';
import { z } from 'zod';

import { register as registerApi } from '@/api/auth.api';
import { PasswordTextField } from '@/components/form/PasswordTextField';
import { Alert, Button, Card, IconButton, Input } from '@/components/tailwind-ui';
import { isNotImplemented } from '@/lib/errors';
import {
  displayNameSchema,
  emailSchema,
  passwordWithConfirmSchema,
  usernameSchema,
} from '@/lib/validation';

/**
 * RegisterPage — TailAdmin self-service registration (Phase 3 port).
 *
 * Fields mirror the backend `createUserSchema` (email, username 3–64,
 * password ≥ 12, optional display name ≤ 128) plus a confirmation field.
 * Password rules are enforced client-side by `passwordSchema` (AUTH-BR-01).
 *
 * NOTE: identity-service has no `POST /auth/register` yet — submitting shows
 * an honest "not available" message rather than pretending success.
 */
const registerSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  displayName: displayNameSchema,
  ...passwordWithConfirmSchema.shape,
});
type RegisterForm = z.infer<typeof registerSchema>;

export function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', username: '', displayName: '', password: '', confirmPassword: '' },
    mode: 'onSubmit',
  });

  const onSubmit = async (values: RegisterForm) => {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      await registerApi({
        email: values.email,
        username: values.username,
        password: values.password,
        displayName: values.displayName || undefined,
      });
      // Backend would verify email then redirect to login.
      navigate('/login', { replace: true });
    } catch (err) {
      setSubmitError(
        isNotImplemented(err) ? t('auth.featureNotAvailable') : (err as Error).message,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full p-6 sm:p-8">
      {/* Heading */}
      <div className="mb-6 flex items-center gap-2">
        <IconButton
          size="sm"
          variant="ghost"
          onClick={() => navigate('/login')}
          aria-label={t('common.backToLogin')}
        >
          <ArrowLeft size={16} aria-hidden />
        </IconButton>
        <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-white">
          {t('auth.createAccount')}
        </h1>
      </div>

      {/* Server error (backend not implemented / network). */}
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
              disabled={isSubmitting}
              error={errors.email ? t(errors.email.message ?? '') : null}
            />
          )}
        />
        <Controller
          name="username"
          control={control}
          render={({ field }) => (
            <Input
              {...field}
              value={field.value ?? ''}
              id="username"
              label={t('auth.username')}
              autoComplete="username"
              disabled={isSubmitting}
              error={errors.username ? t(errors.username.message ?? '') : null}
              hint={errors.username ? null : t('auth.usernameHelp')}
            />
          )}
        />
        <Controller
          name="displayName"
          control={control}
          render={({ field }) => (
            <Input
              {...field}
              value={field.value ?? ''}
              id="displayName"
              label={t('auth.displayName')}
              autoComplete="name"
              disabled={isSubmitting}
              error={errors.displayName ? t(errors.displayName.message ?? '') : null}
            />
          )}
        />
        <Controller
          name="password"
          control={control}
          render={({ field }) => (
            <PasswordTextField
              {...field}
              value={field.value ?? ''}
              id="password"
              label={t('auth.password')}
              autoCompleteValue="new-password"
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
          {isSubmitting ? t('common.submitting') : t('auth.createAccount')}
        </Button>

        <p className="text-center text-sm text-gray-500 dark:text-graydark-600">
          {t('auth.haveAccount')}{' '}
          <RouterLink
            to="/login"
            className="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            {t('auth.login')}
          </RouterLink>
        </p>
      </form>
    </Card>
  );
}
