import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { apiMessage } from '@/api/client';
import { type TenantTier, provisionTenant } from '@/api/tenants';

const TIERS: TenantTier[] = ['STANDARD', 'PROFESSIONAL', 'ENTERPRISE'];

export function TenantCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [tier, setTier] = useState<TenantTier>('STANDARD');
  const [region, setRegion] = useState('local');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const created = await provisionTenant({
        name: name.trim(),
        tier,
        region: region.trim(),
        admin_email: adminEmail.trim(),
        admin_username: adminUsername.trim(),
        admin_password: adminPassword,
      });
      navigate(`/tenants/${created.tenant_id}`, { replace: true });
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="max-w-xl rounded-2xl border border-slate-200 bg-white p-6">
      <h1 className="text-xl font-bold">{t('create.title')}</h1>
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <Field label={t('create.name')} value={name} onChange={setName} required />
      <label className="mt-4 block text-sm font-medium">
        {t('create.tier')}
        <select
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          value={tier}
          onChange={(ev) => setTier(ev.target.value as TenantTier)}
        >
          {TIERS.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </label>
      <Field label={t('create.region')} value={region} onChange={setRegion} required />
      <Field
        label={t('create.adminEmail')}
        value={adminEmail}
        onChange={setAdminEmail}
        type="email"
        required
      />
      <Field
        label={t('create.adminUsername')}
        value={adminUsername}
        onChange={setAdminUsername}
        required
      />
      <label className="mt-4 block text-sm font-medium">
        {t('create.adminPassword')}
        <input
          type="password"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          value={adminPassword}
          onChange={(ev) => setAdminPassword(ev.target.value)}
          required
          minLength={12}
        />
        <span className="mt-1 block text-xs font-normal text-slate-500">
          {t('create.passwordHint')}
        </span>
      </label>
      <button
        type="submit"
        disabled={busy}
        className="mt-6 rounded-lg bg-brand-500 px-4 py-2 font-semibold text-white disabled:opacity-60"
      >
        {busy ? t('common.loading') : t('create.submit')}
      </button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="mt-4 block text-sm font-medium">
      {label}
      <input
        type={type}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      />
    </label>
  );
}
