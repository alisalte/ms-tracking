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
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-ink-950 p-10 text-slate-200 lg:flex">
        <p className="text-sm font-semibold tracking-wide text-teal-300">{t('app.title')}</p>
        <div>
          <h1 className="max-w-md text-4xl font-bold leading-tight text-white">{t('auth.hero')}</h1>
          <p className="mt-4 max-w-md text-sm text-slate-400">{t('auth.hint')}</p>
        </div>
        <p className="text-xs text-slate-500">{t('app.subtitle')}</p>
      </div>
      <div className="flex items-center justify-center bg-paper px-4 py-12">
        <form
          onSubmit={onSubmit}
          className="w-full max-w-md rounded-3xl border border-stone-200 bg-white p-8 shadow-sm"
          data-testid="login-form"
        >
          <h1 className="text-2xl font-bold text-slate-900">{t('auth.login')}</h1>
          <p className="mt-2 text-sm text-slate-500 lg:hidden">{t('auth.hint')}</p>
          {error && (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}
          <label className="mt-6 block text-sm font-medium text-slate-700">
            {t('auth.tenant')}
            <input
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
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
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
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
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="mt-6 w-full rounded-xl bg-brand-500 py-2.5 font-semibold text-white disabled:opacity-60"
          >
            {busy ? t('common.loading') : t('auth.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
