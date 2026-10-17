import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiMessage } from '@/api/client';
import {
  type PermissionGroup,
  type TenantRole,
  type TenantUser,
  createTenantRole,
  createTenantUser,
  listPermissionCatalog,
  listTenantRoles,
  listTenantUsers,
  setTenantUserRole,
  setTenantUserStatus,
  updateTenantRolePermissions,
} from '@/api/tenants';

export function TenantAccessPanel({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [roles, setRoles] = useState<TenantRole[]>([]);
  const [catalog, setCatalog] = useState<PermissionGroup[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [roleId, setRoleId] = useState('');
  const [busy, setBusy] = useState(false);

  const [roleName, setRoleName] = useState('');
  const [roleDescription, setRoleDescription] = useState('');

  const reload = async () => {
    const [nextUsers, nextRoles, nextCatalog] = await Promise.all([
      listTenantUsers(tenantId),
      listTenantRoles(tenantId),
      listPermissionCatalog(tenantId),
    ]);
    setUsers(nextUsers);
    setRoles(nextRoles);
    setCatalog(nextCatalog);
    setRoleId((current) => current || nextRoles[0]?.id || '');
    setSelectedId((current) =>
      current && nextRoles.some((role) => role.id === current)
        ? current
        : (nextRoles[0]?.id ?? null),
    );
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch when the tenant changes.
  useEffect(() => {
    setError(null);
    void reload().catch((err: unknown) => setError(apiMessage(err)));
  }, [tenantId]);

  const selected = roles.find((role) => role.id === selectedId) ?? null;

  useEffect(() => {
    setDraft(selected?.permissions ?? []);
  }, [selected]);

  const roleLabel = (name: string) =>
    name === 'tenant-admin' || name === 'fleet-admin' || name === 'viewer'
      ? t(`roles.${name}`)
      : name;

  const onCreateUser = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await createTenantUser(tenantId, {
        email: email.trim(),
        username: username.trim(),
        password,
        display_name: displayName.trim() || undefined,
        role_id: roleId,
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

  const onCreateRole = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await createTenantRole(tenantId, {
        name: roleName.trim(),
        description: roleDescription.trim() || undefined,
      });
      setRoleName('');
      setRoleDescription('');
      setSelectedId(created.id);
      setNotice(t('access.roleCreated'));
      await reload();
      setSelectedId(created.id);
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onSavePermissions = async () => {
    if (!selected || selected.isSystem) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await updateTenantRolePermissions(tenantId, selected.id, draft);
      setNotice(t('access.permissionsSaved'));
      await reload();
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onChangeUserRole = async (user: TenantUser, nextRoleId: string) => {
    setError(null);
    setNotice(null);
    try {
      await setTenantUserRole(tenantId, user.id, nextRoleId);
      setNotice(t('access.roleChanged'));
      await reload();
    } catch (err) {
      setError(apiMessage(err));
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="tenant-access-panel">
      <p className="text-sm text-slate-600">{t('access.hint')}</p>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>
      )}

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="text-sm font-semibold">{t('detail.addUser')}</h2>
        <form onSubmit={onCreateUser} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={t('detail.email')}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={t('detail.username')}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
            minLength={3}
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={t('detail.password')}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={12}
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={t('detail.displayName')}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <select
            aria-label={t('detail.role')}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={roleId}
            onChange={(event) => setRoleId(event.target.value)}
            required
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {roleLabel(role.name)}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy || !roleId}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? t('common.loading') : t('detail.submitUser')}
          </button>
        </form>
      </section>

      <section className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
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
            {users.map((user) => (
              <tr key={user.id} className="border-t border-slate-100">
                <td className="px-4 py-2">{user.email}</td>
                <td className="px-4 py-2">{user.username}</td>
                <td className="px-4 py-2">
                  <select
                    aria-label={t('access.changeRole')}
                    className="rounded-lg border border-slate-300 px-2 py-1"
                    value={roles.find((role) => user.roles.includes(role.name))?.id ?? ''}
                    onChange={(event) => void onChangeUserRole(user, event.target.value)}
                  >
                    <option value="" disabled>
                      {user.roles.map(roleLabel).join(', ') || '—'}
                    </option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {roleLabel(role.name)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2">{user.status}</td>
                <td className="px-4 py-2">
                  {user.status === 'ACTIVE' ? (
                    <button
                      type="button"
                      className="text-amber-700"
                      onClick={() =>
                        void setTenantUserStatus(tenantId, user.id, 'suspended')
                          .then(reload)
                          .catch((err: unknown) => setError(apiMessage(err)))
                      }
                    >
                      {t('detail.suspendUser')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-emerald-700"
                      onClick={() =>
                        void setTenantUserStatus(tenantId, user.id, 'active')
                          .then(reload)
                          .catch((err: unknown) => setError(apiMessage(err)))
                      }
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

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="text-sm font-semibold">{t('access.rolesTitle')}</h2>
        <form onSubmit={onCreateRole} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={t('access.roleName')}
            value={roleName}
            onChange={(event) => setRoleName(event.target.value)}
            required
            minLength={2}
            maxLength={64}
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={t('access.roleDescription')}
            value={roleDescription}
            onChange={(event) => setRoleDescription(event.target.value)}
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {t('access.createRole')}
          </button>
        </form>
        {roles.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">{t('access.emptyRoles')}</p>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-[16rem_1fr]">
            <ul className="flex flex-col gap-1">
              {roles.map((role) => (
                <li key={role.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(role.id)}
                    className={`w-full rounded-lg px-3 py-2 text-start text-sm ${
                      role.id === selectedId
                        ? 'bg-brand-50 font-semibold text-brand-700'
                        : 'hover:bg-stone-50'
                    }`}
                  >
                    <span className="block">{roleLabel(role.name)}</span>
                    <span className="text-xs text-slate-500">
                      {role.isSystem ? t('access.system') : t('access.custom')} · {role.memberCount}{' '}
                      {t('access.members')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {selected && (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{t('access.matrix')}</h3>
                  {!selected.isSystem && (
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                      onClick={() => void onSavePermissions()}
                    >
                      {t('access.savePermissions')}
                    </button>
                  )}
                </div>
                {selected.permissions.includes('*') && (
                  <p className="mt-2 text-sm text-slate-600">{t('access.allPermissions')}</p>
                )}
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {catalog.map((group) => (
                    <fieldset key={group.domain} className="rounded-lg border border-stone-200 p-3">
                      <legend className="px-1 text-sm font-semibold">
                        {t(`access.domain.${group.domain}`, { defaultValue: group.domain })}
                      </legend>
                      <div className="mt-2 flex flex-col gap-1">
                        {group.permissions.map((permission) => {
                          const checked =
                            draft.includes(permission) || selected.permissions.includes('*');
                          return (
                            <label key={permission} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={selected.isSystem || selected.permissions.includes('*')}
                                onChange={() =>
                                  setDraft((prev) =>
                                    prev.includes(permission)
                                      ? prev.filter((item) => item !== permission)
                                      : [...prev, permission],
                                  )
                                }
                              />
                              <span className="font-mono text-xs" dir="ltr">
                                {permission}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
