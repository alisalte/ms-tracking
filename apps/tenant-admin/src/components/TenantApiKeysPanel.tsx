import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiMessage } from '@/api/client';
import {
  type TenantApiKey,
  createTenantApiKey,
  listTenantApiKeys,
  revokeTenantApiKey,
} from '@/api/tenants';

const field = 'rounded-lg border border-slate-300 px-3 py-2 text-sm';

export function TenantApiKeysPanel({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<TenantApiKey[]>([]);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState('tracking.read');
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => setKeys(await listTenantApiKeys(tenantId));

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch when the tenant changes.
  useEffect(() => {
    setError(null);
    setPlaintext(null);
    void reload().catch((err: unknown) => setError(apiMessage(err)));
  }, [tenantId]);

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    const scopeList = scopes
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!name.trim() || scopeList.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createTenantApiKey(tenantId, { name: name.trim(), scopes: scopeList });
      setPlaintext(created.key);
      setName('');
      await reload();
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onRevoke = async (key: TenantApiKey) => {
    if (!window.confirm(t('apikeys.confirmRevoke', { name: key.name }))) return;
    setError(null);
    try {
      await revokeTenantApiKey(tenantId, key.id);
      await reload();
    } catch (err) {
      setError(apiMessage(err));
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="tenant-apikeys-panel">
      <p className="text-sm text-slate-600">{t('apikeys.hint')}</p>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {plaintext && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-semibold">{t('apikeys.plaintextTitle')}</p>
          <code className="mt-1 block break-all font-mono text-xs">{plaintext}</code>
          <p className="mt-1 text-xs">{t('apikeys.plaintextHelp')}</p>
        </div>
      )}

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="text-sm font-semibold">{t('apikeys.create')}</h2>
        <form onSubmit={onCreate} className="mt-3 grid gap-3 sm:grid-cols-3">
          <input
            className={field}
            placeholder={t('apikeys.name')}
            value={name}
            maxLength={128}
            required
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className={field}
            placeholder={t('apikeys.scopes')}
            aria-label={t('apikeys.scopes')}
            value={scopes}
            required
            onChange={(e) => setScopes(e.target.value)}
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? t('common.loading') : t('apikeys.submit')}
          </button>
        </form>
        <p className="mt-2 text-xs text-slate-500">{t('apikeys.scopesHint')}</p>
      </section>

      <section className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="text-start text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">{t('apikeys.name')}</th>
              <th className="px-4 py-2 font-medium">{t('apikeys.prefix')}</th>
              <th className="px-4 py-2 font-medium">{t('apikeys.scopes')}</th>
              <th className="px-4 py-2 font-medium">{t('detail.status')}</th>
              <th className="px-4 py-2 font-medium">{t('tenants.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-slate-500">
                  {t('apikeys.empty')}
                </td>
              </tr>
            )}
            {keys.map((key) => (
              <tr key={key.id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium">{key.name}</td>
                <td className="px-4 py-2 font-mono text-xs">{key.keyPrefix}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{key.scopes.join(', ')}</td>
                <td className="px-4 py-2">{key.status}</td>
                <td className="px-4 py-2">
                  {key.status === 'ACTIVE' && (
                    <button
                      type="button"
                      className="text-red-700"
                      onClick={() => void onRevoke(key)}
                    >
                      {t('apikeys.revoke')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
