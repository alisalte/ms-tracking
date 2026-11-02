import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiMessage } from '@/api/client';
import {
  type TenantEmailSettingsState,
  deleteTenantEmailSettings,
  getTenantEmailSettings,
  saveTenantEmailSettings,
  sendTenantEmailTest,
} from '@/api/report-email';

const field = 'rounded-lg border border-slate-300 px-3 py-2 text-sm';

interface Draft {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  clearPassword: boolean;
  fromAddress: string;
}

const EMPTY: Draft = {
  enabled: true,
  host: '',
  port: 587,
  secure: false,
  username: '',
  password: '',
  clearPassword: false,
  fromAddress: '',
};

function toDraft(state: TenantEmailSettingsState): Draft {
  const s = state.settings;
  if (!s) return EMPTY;
  return { ...EMPTY, ...s, username: s.username ?? '' };
}

export function TenantEmailPanel({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<TenantEmailSettingsState | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [testTo, setTestTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    getTenantEmailSettings(tenantId)
      .then((s) => {
        setState(s);
        setDraft(toDraft(s));
      })
      .catch((err: unknown) => setError(apiMessage(err)));

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload only when the tenant changes
  useEffect(() => {
    setError(null);
    setNotice(null);
    void load();
  }, [tenantId]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(ok);
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      let password: string | undefined;
      if (draft.clearPassword) password = '';
      else if (draft.password) password = draft.password;
      await saveTenantEmailSettings(tenantId, {
        enabled: draft.enabled,
        host: draft.host,
        port: draft.port,
        secure: draft.secure,
        username: draft.username || null,
        password,
        fromAddress: draft.fromAddress,
      });
      await load();
    }, t('email.saved'));
  };

  const onDelete = () =>
    void run(async () => {
      await deleteTenantEmailSettings(tenantId);
      await load();
    }, t('email.removed'));

  const onTest = () => void run(() => sendTenantEmailTest(tenantId, testTo), t('email.testSent'));

  const configured = state?.settings != null;

  return (
    <div className="flex flex-col gap-4" data-testid="tenant-email-panel">
      <p className="text-sm text-slate-600">{t('email.hint')}</p>
      {!configured && state && <p className="text-sm text-slate-500">{t('email.usingDefault')}</p>}
      {state && !state.encryptionAvailable && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t('email.noEncryptionKey')}
        </p>
      )}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>
      )}
      {state && (
        <form
          onSubmit={onSubmit}
          className="grid gap-3 rounded-xl border border-stone-200 bg-white p-4 sm:grid-cols-2"
        >
          <label className="flex flex-col gap-1 text-sm">
            {t('email.host')}
            <input
              className={field}
              value={draft.host}
              required
              maxLength={253}
              onChange={(e) => set('host', e.target.value)}
              data-testid="email-host"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('email.port')}
            <input
              className={field}
              type="number"
              min={1}
              max={65535}
              value={draft.port}
              required
              onChange={(e) => set('port', Number(e.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('email.username')}
            <input
              className={field}
              value={draft.username}
              autoComplete="off"
              onChange={(e) => set('username', e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('email.password')}
            <input
              className={field}
              type="password"
              autoComplete="new-password"
              value={draft.password}
              placeholder={state.settings?.hasPassword ? t('email.passwordKept') : ''}
              disabled={draft.clearPassword}
              onChange={(e) => set('password', e.target.value)}
              data-testid="email-password"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            {t('email.from')}
            <input
              className={field}
              type="email"
              value={draft.fromAddress}
              required
              maxLength={254}
              onChange={(e) => set('fromAddress', e.target.value)}
              data-testid="email-from"
            />
          </label>
          <div className="flex flex-wrap gap-4 text-sm sm:col-span-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.secure}
                onChange={(e) => set('secure', e.target.checked)}
              />
              {t('email.secure')}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => set('enabled', e.target.checked)}
              />
              {t('email.enabled')}
            </label>
            {state.settings?.hasPassword && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.clearPassword}
                  onChange={(e) => set('clearPassword', e.target.checked)}
                />
                {t('email.clearPassword')}
              </label>
            )}
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={busy}
              data-testid="email-save"
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? t('common.loading') : t('email.save')}
            </button>
            {configured && (
              <button
                type="button"
                disabled={busy}
                onClick={onDelete}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-60"
              >
                {t('email.remove')}
              </button>
            )}
          </div>
        </form>
      )}
      {state && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-stone-200 bg-white p-4">
          <label className="flex min-w-60 flex-1 flex-col gap-1 text-sm">
            {t('email.testTo')}
            <input
              className={field}
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              data-testid="email-test-to"
            />
          </label>
          <button
            type="button"
            disabled={busy || !testTo}
            onClick={onTest}
            data-testid="email-test"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-60"
          >
            {t('email.sendTest')}
          </button>
          <p className="basis-full text-xs text-slate-500">{t('email.testNote')}</p>
        </div>
      )}
    </div>
  );
}
