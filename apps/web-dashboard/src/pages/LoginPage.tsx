import { zodResolver } from '@hookform/resolvers/zod';
import {
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControlLabel,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';

import { FormAlert } from '@/components/form/FormAlert';
import { PasswordTextField } from '@/components/form/PasswordTextField';
import { useAuth } from '@/hooks/useAuth';
import { emailSchema } from '@/lib/validation';

/**
 * LoginPage — email + password + tenant ID authentication.
 *
 * The login wireframe (`Authentication.md` §9.2): email, password (with a
 * show/hide toggle), and — because the backend requires an `X-Tenant-Id`
 * header and no public tenant resolver exists yet — a tenant field (documented
 * divergence from AUTH-BR-12, to be replaced by subdomain resolution).
 *
 * Validation runs through react-hook-form + zod (UI_UX_Design.md appendix).
 * On success it navigates to the `?redirect` path (default `/dashboard`).
 */
const loginSchema = z.object({
  tenantId: z.string().trim().min(1, { message: 'validation.tenantId.required' }),
  email: emailSchema,
  password: z.string().min(1, { message: 'validation.password.required' }),
  rememberDevice: z.boolean(),
});
type LoginForm = z.infer<typeof loginSchema>;

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
    defaultValues: { tenantId: '', email: '', password: '', rememberDevice: false },
    mode: 'onSubmit',
  });

  const onSubmit = async (values: LoginForm) => {
    clearError();
    const success = await login(values.email, values.password, values.tenantId);
    if (success) {
      navigate(redirectPath, { replace: true });
    }
  };

  return (
    <Card sx={{ width: '100%', maxWidth: 420 }}>
      <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
        {/* Branding */}
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Typography variant="h4" fontWeight={800} sx={{ letterSpacing: '-0.02em' }}>
            {t('auth.login')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('auth.signInSubtitle')}
          </Typography>
        </Box>

        {/* Server / auth-store error (e.g. invalid credentials, lockout) */}
        <FormAlert severity="error" message={error} />

        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Controller
            name="tenantId"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                fullWidth
                id="tenantId"
                label={t('auth.tenantId')}
                margin="normal"
                autoComplete="organization"
                autoFocus
                disabled={isLoading}
                error={Boolean(errors.tenantId)}
                helperText={errors.tenantId ? t(errors.tenantId.message!) : ' '}
              />
            )}
          />

          <Controller
            name="email"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                fullWidth
                id="email"
                label={t('auth.email')}
                margin="normal"
                type="email"
                autoComplete="email"
                disabled={isLoading}
                error={Boolean(errors.email)}
                helperText={errors.email ? t(errors.email.message!) : ' '}
              />
            )}
          />

          <Controller
            name="password"
            control={control}
            render={({ field }) => (
              <PasswordTextField
                {...field}
                fullWidth
                id="password"
                label={t('auth.password')}
                margin="normal"
                autoCompleteValue="current-password"
                disabled={isLoading}
                error={Boolean(errors.password)}
                helperText={errors.password ? t(errors.password.message!) : ' '}
              />
            )}
          />

          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ my: 1 }}>
            <Controller
              name="rememberDevice"
              control={control}
              render={({ field }) => (
                <FormControlLabel
                  control={<Checkbox {...field} checked={field.value} size="small" />}
                  label={<Typography variant="body2">{t('auth.rememberDevice')}</Typography>}
                />
              )}
            />
            <Link component={RouterLink} to="/forgot-password" variant="body2" underline="hover">
              {t('auth.forgotPassword')}
            </Link>
          </Stack>

          <Button
            type="submit"
            fullWidth
            variant="contained"
            size="large"
            disabled={isLoading}
            sx={{ mt: 3, mb: 2, py: 1.5, fontSize: '0.95rem' }}
          >
            {isLoading ? t('auth.loggingIn') : t('auth.login')}
          </Button>

          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary" component="span">
              {t('auth.noAccount')}{' '}
            </Typography>
            <Link component={RouterLink} to="/register" variant="body2" underline="hover">
              {t('auth.signUp')}
            </Link>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
