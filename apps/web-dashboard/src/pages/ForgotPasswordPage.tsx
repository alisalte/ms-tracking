import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, MailCheck } from 'lucide-react';
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

import { forgotPassword as forgotPasswordApi } from '@/api/auth.api';
import { FormAlert } from '@/components/form/FormAlert';
import { isNotImplemented } from '@/lib/errors';
import { emailSchema } from '@/lib/validation';

/**
 * ForgotPasswordPage — request a password-reset email (documented; backend pending).
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
      <Card sx={{ width: '100%', maxWidth: 420 }}>
        <CardContent sx={{ p: 4, textAlign: 'center' }}>
          <MailCheck size={48} color="var(--mui-palette-primary-main)" />
          <Typography variant="h5" fontWeight={700} sx={{ mt: 2, mb: 1 }}>
            {t('auth.resetLinkSentTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t('auth.resetLinkSentBody')}
          </Typography>
          <Button variant="contained" fullWidth onClick={() => navigate('/login')}>
            {t('common.backToLogin')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card sx={{ width: '100%', maxWidth: 420 }}>
      <CardContent sx={{ p: 4 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
          <IconButton size="small" onClick={() => navigate('/login')} aria-label={t('common.backToLogin')}>
            <ArrowLeft size={20} />
          </IconButton>
          <Typography variant="h5" fontWeight={700}>
            {t('auth.forgotPassword')}
          </Typography>
        </Stack>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('auth.forgotPasswordHelp')}
        </Typography>

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
                autoFocus
                disabled={isSubmitting}
                error={Boolean(errors.email)}
                helperText={errors.email ? t(errors.email.message!) : ' '}
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
            {isSubmitting ? t('common.submitting') : t('auth.sendResetLink')}
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
