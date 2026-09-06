import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { ForbiddenTenantAdminError, login } from '@/api/auth';
import { apiMessage } from '@/api/client';
import { clearSession } from '@/lib/session';

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tenantId, setTenantId] = useState('FleetVision');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(tenantId.trim(), email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      clearSession();
      setError(err instanceof ForbiddenTenantAdminError ? t('auth.forbidden') : apiMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
        data-testid="login-form"
      >
        <h1 className="text-2xl font-bold text-slate-900">{t('auth.login')}</h1>
        <p className="mt-2 text-sm text-slate-500">{t('auth.hint')}</p>
        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        <label className="mt-6 block text-sm font-medium text-slate-700">
          {t('auth.tenant')}
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            value={tenantId}
            onChange={(ev) => setTenantId(ev.target.value)}
            required
            autoComplete="organization"
          />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-700">
          {t('auth.email')}
          <input
            type="email"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            required
            autoComplete="username"
          />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-700">
          {t('auth.password')}
          <input
            type="password"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            required
            autoComplete="current-password"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full rounded-lg bg-brand-500 py-2.5 font-semibold text-white disabled:opacity-60"
        >
          {busy ? t('common.loading') : t('auth.submit')}
        </button>
      </form>
    </div>
  );
}
