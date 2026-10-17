import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';

import { PasswordTextField } from '@/components/form/PasswordTextField';
import { Alert, Button, Card, Checkbox, Input } from '@/components/tailwind-ui';
import { useAuth } from '@/hooks/useAuth';

/**
 * LoginPage — TailAdmin sign-in.
 *
 * Email or username plus password. The account's tenant is resolved on the
 * server from that user, so the form does not ask for an organization name.
 * On success it navigates to the `?redirect` path (default `/dashboard`);
 * server errors surface in a TailAdmin Alert.
 */
const loginSchema = z.object({
  email: z.string().trim().min(1, { message: 'validation.identifier.required' }),
  password: z.string().min(1, { message: 'validation.password.required' }),
  rememberDevice: z.boolean(),
});
type LoginForm = z.infer<typeof loginSchema>;

const EMPTY_LOGIN: LoginForm = {
  email: '',
  password: '',
  rememberDevice: false,
};

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const { login, isLoading, error, clearError } = useAuth();
  const redirectPath = searchParams.get('redirect') ?? '/dashboard';

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: EMPTY_LOGIN,
    mode: 'onSubmit',
  });

  const onSubmit = async (values: LoginForm) => {
    clearError();
    const success = await login(values.email, values.password);
    if (success) {
      navigate(redirectPath, { replace: true });
    }
  };

  return (
    <Card className="w-full p-6 sm:p-8">
      {/* Heading */}
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-white">
          {t('auth.login')}
        </h1>
        <p className="mt-1.5 text-sm text-gray-500 dark:text-graydark-600">
          {t('auth.signInSubtitle')}
        </p>
      </div>

      {/* Server / auth-store error (invalid credentials, lockout, network) */}
      {error && (
        <Alert variant="danger" className="mb-4">
          {error}
        </Alert>
      )}

      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        method="post"
        autoComplete="off"
        className="flex flex-col gap-4"
      >
        <Controller
          name="email"
          control={control}
          render={({ field }) => (
            <Input
              {...field}
              value={field.value ?? ''}
              id="email"
              type="text"
              label={t('auth.identifier')}
              autoComplete="username"
              autoFocus
              disabled={isLoading}
              error={errors.email ? t(errors.email.message ?? '') : null}
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
              autoCompleteValue="off"
              disabled={isLoading}
              error={errors.password ? t(errors.password.message ?? '') : null}
            />
          )}
        />

        <div className="flex items-center justify-between gap-2">
          <Controller
            name="rememberDevice"
            control={control}
            render={({ field }) => (
              <Checkbox
                checked={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
                id="rememberDevice"
                disabled={isLoading}
                label={t('auth.rememberDevice')}
              />
            )}
          />
          <RouterLink
            to="/forgot-password"
            className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            {t('auth.forgotPassword')}
          </RouterLink>
        </div>

        <Button type="submit" size="lg" fullWidth disabled={isLoading} loading={isLoading}>
          {isLoading ? t('auth.loggingIn') : t('auth.login')}
        </Button>

        <p className="text-center text-sm text-gray-500 dark:text-graydark-600">
          {t('auth.noAccount')}{' '}
          <RouterLink
            to="/register"
            className="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            {t('auth.signUp')}
          </RouterLink>
        </p>
      </form>
    </Card>
  );
}
