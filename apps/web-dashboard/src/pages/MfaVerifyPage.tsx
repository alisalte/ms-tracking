import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  Input,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { ArrowLeft, KeyRound, ShieldAlert, Smartphone } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import { verifyMfa } from '@/api/auth.api';
import { FormAlert } from '@/components/form/FormAlert';
import { isNotImplemented } from '@/lib/errors';
import type { MfaMethod } from '@/types/auth.types';

/** Number of OTP digits (TOTP code-length per IAM config). */
const OTP_LENGTH = 6;

/**
 * MfaVerifyPage — second-factor verification (documented; backend pending).
 *
 * The login flow returns a 202 challenge with `mfa_token`; the client navigates
 * here (passing `?mfa_token=`). The page renders auto-advancing single-digit
 * inputs and a factor switcher (TOTP / WebAuthn / backup code), per
 * `Authentication.md` §9.3. On success the documented endpoint exchanges
 * `mfa_token` + code for access/refresh tokens.
 *
 * NOTE: identity-service has no MFA backend — submitting surfaces the gap
 * honestly rather than faking authentication.
 */
export function MfaVerifyPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const mfaToken = searchParams.get('mfa_token');

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [method, setMethod] = useState<MfaMethod>('totp');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const code = digits.join('');

  const handleDigitChange = (index: number, raw: string) => {
    // Accept a single digit; allow paste of the full code.
    const cleaned = raw.replace(/\D/g, '');
    if (cleaned.length === 0) {
      const next = [...digits];
      next[index] = '';
      setDigits(next);
      return;
    }
    if (cleaned.length >= OTP_LENGTH) {
      // Pasted the whole code — distribute it.
      setDigits(cleaned.slice(0, OTP_LENGTH).split(''));
      inputRefs.current[Math.min(OTP_LENGTH - 1, index)]?.focus();
      return;
    }
    const next = [...digits];
    next[index] = cleaned[0] ?? '';
    setDigits(next);
    if (index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const onSubmit = async () => {
    setSubmitError(null);
    if (code.length !== OTP_LENGTH) {
      setSubmitError(t('auth.mfa.codeIncomplete'));
      return;
    }
    setIsSubmitting(true);
    try {
      await verifyMfa({ mfaToken: mfaToken ?? '', code, method });
      // On success the backend returns tokens → navigate to the dashboard.
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setSubmitError(
        isNotImplemented(err) ? t('auth.featureNotAvailable') : (err as Error).message,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // No mfa_token → the user landed here without a challenge.
  if (!mfaToken) {
    return (
      <Card sx={{ width: '100%', maxWidth: 420 }}>
        <CardContent sx={{ p: 4 }}>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t('auth.mfa.noChallenge')}
          </Alert>
          <Button fullWidth variant="contained" onClick={() => navigate('/login')}>
            {t('common.backToLogin')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const methodOptions: { value: MfaMethod; icon: React.ReactNode; label: string }[] = [
    { value: 'totp', icon: <Smartphone size={18} />, label: t('auth.mfa.totp') },
    { value: 'webauthn', icon: <KeyRound size={18} />, label: t('auth.mfa.webauthn') },
    { value: 'backup-code', icon: <ShieldAlert size={18} />, label: t('auth.mfa.backupCode') },
  ];

  return (
    <Card sx={{ width: '100%', maxWidth: 420 }}>
      <CardContent sx={{ p: 4 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
          <IconButton
            size="small"
            onClick={() => navigate('/login')}
            aria-label={t('common.backToLogin')}
          >
            <ArrowLeft size={20} />
          </IconButton>
          <Typography variant="h5" fontWeight={700}>
            {t('auth.mfa.verifyTitle')}
          </Typography>
        </Stack>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t('auth.mfa.verifyHelp')}
        </Typography>

        <ToggleButtonGroup
          value={method}
          exclusive
          onChange={(_, v: MfaMethod | null) => v && setMethod(v)}
          size="small"
          sx={{ mb: 3, display: 'flex', flexWrap: 'wrap' }}
        >
          {methodOptions.map((opt) => (
            <ToggleButton key={opt.value} value={opt.value} sx={{ gap: 0.75, px: 1.5 }}>
              {opt.icon}
              <Typography variant="caption">{opt.label}</Typography>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        {/* OTP digit inputs */}
        <Stack direction="row" spacing={1} justifyContent="center" sx={{ mb: 3 }}>
          {digits.map((digit, i) => (
            <Input
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-position OTP inputs
              key={i}
              inputRef={(el) => {
                inputRefs.current[i] = el;
              }}
              value={digit}
              onChange={(e) => handleDigitChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              inputProps={{
                maxLength: 1,
                style: { textAlign: 'center', fontSize: '1.5rem', width: '2.5rem', height: '3rem' },
                'aria-label': t('auth.mfa.digitLabel', { n: i + 1 }),
                inputMode: 'numeric',
                pattern: '[0-9]*',
              }}
            />
          ))}
        </Stack>

        <FormAlert severity="error" message={submitError} />

        <Button
          fullWidth
          variant="contained"
          size="large"
          disabled={isSubmitting || code.length !== OTP_LENGTH}
          onClick={onSubmit}
          sx={{ mb: 2 }}
        >
          {isSubmitting ? t('common.submitting') : t('auth.mfa.verify')}
        </Button>

        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="caption" color="text.secondary">
            {t('auth.mfa.rateLimitedHelp')}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}
