import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';
import type { z } from 'zod';

import { resetPassword as resetPasswordApi } from '@/api/auth.api';
import { FormAlert } from '@/components/form/FormAlert';
import { PasswordTextField } from '@/components/form/PasswordTextField';
import { isNotImplemented } from '@/lib/errors';
import { passwordWithConfirmSchema } from '@/lib/validation';

/**
 * ResetPasswordPage — set a new password with a one-time recovery token.
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
      <Card sx={{ width: '100%', maxWidth: 420 }}>
        <CardContent sx={{ p: 4 }}>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t('auth.resetTokenMissing')}
          </Alert>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('auth.resetTokenMissingHelp')}
          </Typography>
          <Button fullWidth variant="contained" onClick={() => navigate('/forgot-password')}>
            {t('auth.forgotPassword')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card sx={{ width: '100%', maxWidth: 420 }}>
      <CardContent sx={{ p: 4 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <IconButton
            size="small"
            onClick={() => navigate('/login')}
            aria-label={t('common.backToLogin')}
          >
            <ArrowLeft size={20} />
          </IconButton>
          <Typography variant="h5" fontWeight={700}>
            {t('auth.resetPassword')}
          </Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('auth.resetPasswordHelp')}
        </Typography>

        <FormAlert severity="error" message={submitError} />

        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Controller
            name="password"
            control={control}
            render={({ field }) => (
              <PasswordTextField
                {...field}
                fullWidth
                label={t('auth.newPassword')}
                margin="normal"
                autoCompleteValue="new-password"
                autoFocus
                disabled={isSubmitting}
                error={Boolean(errors.password)}
                helperText={
                  errors.password ? t(errors.password?.message ?? '') : t('auth.passwordPolicy')
                }
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
                helperText={errors.confirmPassword ? t(errors.confirmPassword?.message ?? '') : ' '}
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
            {isSubmitting ? t('common.submitting') : t('auth.resetPassword')}
          </Button>

          <Box sx={{ textAlign: 'center' }}>
            <Link component={RouterLink} to="/login" variant="body2" underline="hover">
              {t('common.backToLogin')}
            </Link>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
