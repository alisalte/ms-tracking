import { ArrowLeft, KeyRound, ShieldAlert, Smartphone } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import { verifyMfa } from '@/api/auth.api';
import { Alert, Button, Card, IconButton } from '@/components/tailwind-ui';
import { isNotImplemented } from '@/lib/errors';
import type { MfaMethod } from '@/types/auth.types';

/** Number of OTP digits (TOTP code-length per IAM config). */
const OTP_LENGTH = 6;

/**
 * MfaVerifyPage — TailAdmin second-factor verification (Phase 3 port).
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
      <Card className="w-full p-6 sm:p-8">
        <Alert variant="warning" className="mb-4">
          {t('auth.mfa.noChallenge')}
        </Alert>
        <Button fullWidth onClick={() => navigate('/login')}>
          {t('common.backToLogin')}
        </Button>
      </Card>
    );
  }

  const methodOptions: { value: MfaMethod; icon: React.ReactNode; label: string }[] = [
    { value: 'totp', icon: <Smartphone size={15} aria-hidden />, label: t('auth.mfa.totp') },
    { value: 'webauthn', icon: <KeyRound size={15} aria-hidden />, label: t('auth.mfa.webauthn') },
    {
      value: 'backup-code',
      icon: <ShieldAlert size={15} aria-hidden />,
      label: t('auth.mfa.backupCode'),
    },
  ];

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
          {t('auth.mfa.verifyTitle')}
        </h1>
      </div>

      <p className="mb-6 text-sm text-gray-500 dark:text-graydark-600">
        {t('auth.mfa.verifyHelp')}
      </p>

      {/* Factor switcher (TOTP / WebAuthn / backup code). */}
      <fieldset
        aria-label={t('auth.mfa.verifyTitle')}
        className="mb-6 inline-flex flex-wrap rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-white/10 dark:bg-graydark-300"
      >
        {methodOptions.map((opt) => {
          const active = method === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={active}
              onClick={() => setMethod(opt.value)}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                active
                  ? 'bg-white text-brand-600 shadow-sm dark:bg-graydark-400 dark:text-brand-300'
                  : 'text-gray-500 hover:text-gray-800 dark:text-graydark-600 dark:hover:text-graydark-800'
              }`}
            >
              {opt.icon}
              {opt.label}
            </button>
          );
        })}
      </fieldset>

      {/* OTP digit inputs */}
      <div className="mb-6 flex justify-center gap-2">
        {digits.map((digit, i) => (
          <input
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-position OTP inputs
            key={i}
            ref={(el) => {
              inputRefs.current[i] = el;
            }}
            value={digit}
            onChange={(e) => handleDigitChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            maxLength={1}
            aria-label={t('auth.mfa.digitLabel', { n: i + 1 })}
            inputMode="numeric"
            pattern="[0-9]*"
            className="h-12 w-10 rounded-lg border border-gray-300 bg-white text-center text-2xl text-gray-900 transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-graydark-300 dark:text-white"
          />
        ))}
      </div>

      {/* Code / server error. */}
      {submitError && (
        <Alert variant="danger" className="mb-4">
          {submitError}
        </Alert>
      )}

      <Button
        fullWidth
        size="lg"
        disabled={isSubmitting || code.length !== OTP_LENGTH}
        loading={isSubmitting}
        onClick={onSubmit}
        className="mb-4"
      >
        {isSubmitting ? t('common.submitting') : t('auth.mfa.verify')}
      </Button>

      <p className="text-center text-xs text-gray-500 dark:text-graydark-600">
        {t('auth.mfa.rateLimitedHelp')}
      </p>
    </Card>
  );
}
