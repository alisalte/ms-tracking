import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft } from 'lucide-react';
import {
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useNavigate } from 'react-router';
import { z } from 'zod';

import { register as registerApi } from '@/api/auth.api';
import { FormAlert } from '@/components/form/FormAlert';
import { PasswordTextField } from '@/components/form/PasswordTextField';
import { isNotImplemented } from '@/lib/errors';
import {
  displayNameSchema,
  emailSchema,
  passwordWithConfirmSchema,
  usernameSchema,
} from '@/lib/validation';

/**
 * RegisterPage — self-service registration (documented; backend pending).
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
    <Card sx={{ width: '100%', maxWidth: 460 }}>
      <CardContent sx={{ p: 4 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
          <IconButton size="small" onClick={() => navigate('/login')} aria-label={t('common.backToLogin')}>
            <ArrowLeft size={20} />
          </IconButton>
          <Typography variant="h5" fontWeight={700}>
            {t('auth.createAccount')}
          </Typography>
        </Stack>

        <FormAlert severity="error" message={submitError} />

        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Controller
            name="email"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                fullWidth
                label={t('auth.email')}
                margin="normal"
                type="email"
                autoComplete="email"
                disabled={isSubmitting}
                error={Boolean(errors.email)}
                helperText={errors.email ? t(errors.email.message!) : ' '}
              />
            )}
          />
          <Controller
            name="username"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                fullWidth
                label={t('auth.username')}
                margin="normal"
                autoComplete="username"
                disabled={isSubmitting}
                error={Boolean(errors.username)}
                helperText={errors.username ? t(errors.username.message!) : t('auth.usernameHelp')}
              />
            )}
          />
          <Controller
            name="displayName"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                fullWidth
                label={t('auth.displayName')}
                margin="normal"
                autoComplete="name"
                disabled={isSubmitting}
                error={Boolean(errors.displayName)}
                helperText={errors.displayName ? t(errors.displayName.message!) : ' '}
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
                label={t('auth.password')}
                margin="normal"
                autoCompleteValue="new-password"
                disabled={isSubmitting}
                error={Boolean(errors.password)}
                helperText={errors.password ? t(errors.password.message!) : t('auth.passwordPolicy')}
              />
            )}
          />
          <Controller
            name="confirmPassword"
            control={control}
            render={({ field }) => (
              <PasswordTextField
                {...field}
                fullWidth
                label={t('auth.confirmPassword')}
                margin="normal"
                autoCompleteValue="new-password"
                disabled={isSubmitting}
                error={Boolean(errors.confirmPassword)}
                helperText={errors.confirmPassword ? t(errors.confirmPassword.message!) : ' '}
              />
            )}
          />

          <Button
            type="submit"
            fullWidth
            variant="contained"
            size="large"
            disabled={isSubmitting}
            sx={{ mt: 2, mb: 2 }}
          >
            {isSubmitting ? t('common.submitting') : t('auth.createAccount')}
          </Button>

          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary" component="span">
              {t('auth.haveAccount')}{' '}
            </Typography>
            <Link component={RouterLink} to="/login" variant="body2" underline="hover">
              {t('auth.login')}
            </Link>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
