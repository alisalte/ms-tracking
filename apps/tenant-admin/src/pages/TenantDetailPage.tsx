import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

import { apiMessage } from '@/api/client';
import {
  type TenantRow,
  type TenantUser,
  createTenantUser,
  getTenant,
  listTenantUsers,
  setTenantUserStatus,
} from '@/api/tenants';

const ROLES = ['tenant-admin', 'fleet-admin', 'viewer'] as const;

export function TenantDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [tenant, setTenant] = useState<TenantRow | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number]>('viewer');
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    if (!id) return;
    setError(null);
    try {
      const [tnt, list] = await Promise.all([getTenant(id), listTenantUsers(id)]);
      setTenant(tnt);
      setUsers(list);
    } catch (err) {
      setError(apiMessage(err));
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch when the route id changes.
  useEffect(() => {
    void reload();
  }, [id]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await createTenantUser(id, {
        email: email.trim(),
        username: username.trim(),
        password,
        display_name: displayName.trim() || undefined,
        role_name: role,
      });
      setEmail('');
      setUsername('');
      setPassword('');
      setDisplayName('');
      setNotice(t('detail.userCreated'));
      await reload();
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!id) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to="/" className="text-sm text-brand-600 no-underline">
          ← {t('common.back')}
        </Link>
        <h1 className="mt-2 text-xl font-bold">{tenant?.name ?? t('detail.title')}</h1>
        {tenant && (
          <p className="mt-1 text-sm text-slate-500">
            {tenant.tier} · {tenant.region} · {tenant.status}
          </p>
        )}
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">{t('detail.addUser')}</h2>
        <form onSubmit={onCreate} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={t('detail.email')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={t('detail.username')}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={t('detail.password')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={t('detail.displayName')}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <select
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={role}
            onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? t('common.loading') : t('detail.submitUser')}
          </button>
        </form>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <h2 className="px-4 pt-4 font-semibold">{t('detail.users')}</h2>
        <table className="mt-2 w-full text-sm">
          <thead className="text-start text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">{t('detail.email')}</th>
              <th className="px-4 py-2 font-medium">{t('detail.username')}</th>
              <th className="px-4 py-2 font-medium">{t('detail.role')}</th>
              <th className="px-4 py-2 font-medium">{t('detail.status')}</th>
              <th className="px-4 py-2 font-medium">{t('tenants.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="px-4 py-2">{u.email}</td>
                <td className="px-4 py-2">{u.username}</td>
                <td className="px-4 py-2">{u.roles.join(', ') || '—'}</td>
                <td className="px-4 py-2">{u.status}</td>
                <td className="px-4 py-2">
                  {u.status === 'ACTIVE' ? (
                    <button
                      type="button"
                      className="text-amber-700"
                      onClick={() => void setTenantUserStatus(id, u.id, 'suspended').then(reload)}
                    >
                      {t('detail.suspendUser')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-emerald-700"
                      onClick={() => void setTenantUserStatus(id, u.id, 'active').then(reload)}
                    >
                      {t('detail.activateUser')}
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
