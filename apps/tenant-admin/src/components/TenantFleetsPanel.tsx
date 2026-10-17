import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiMessage } from '@/api/client';
import {
  type PlatformDevice,
  type PlatformFleet,
  assignDeviceToFleet,
  createTenantFleet,
  listTenantDevices,
  listTenantFleets,
} from '@/api/platform-assets';

export function TenantFleetsPanel({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation();
  const [fleets, setFleets] = useState<PlatformFleet[]>([]);
  const [devices, setDevices] = useState<PlatformDevice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});

  const reload = async () => {
    const [nextFleets, nextDevices] = await Promise.all([
      listTenantFleets(tenantId),
      listTenantDevices(tenantId),
    ]);
    setFleets(nextFleets);
    setDevices(nextDevices);
    setChoice((prev) => {
      const next = { ...prev };
      for (const device of nextDevices) {
        if (!next[device.id] && device.fleetId) next[device.id] = device.fleetId;
      }
      return next;
    });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch when the tenant changes.
  useEffect(() => {
    setError(null);
    void reload().catch((err: unknown) => setError(apiMessage(err)));
  }, [tenantId]);

  const activeFleets = fleets.filter((fleet) => fleet.status === 'ACTIVE');

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await createTenantFleet(tenantId, {
        name: name.trim(),
        code: code.trim(),
        description: description.trim() || undefined,
      });
      setName('');
      setCode('');
      setDescription('');
      setNotice(t('fleets.created'));
      await reload();
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onAssign = async (device: PlatformDevice) => {
    const fleetId = choice[device.id];
    if (!fleetId) return;
    setAssigningId(device.id);
    setError(null);
    setNotice(null);
    try {
      await assignDeviceToFleet(tenantId, device.id, fleetId);
      setNotice(t('fleets.assigned'));
      await reload();
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setAssigningId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="tenant-fleets-panel">
      <p className="text-sm text-slate-600">{t('fleets.hint')}</p>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>
      )}

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="text-sm font-semibold">{t('fleets.title')}</h2>
        <form
          data-testid="create-fleet-form"
          onSubmit={onCreate}
          className="mt-4 grid gap-3 sm:grid-cols-2"
        >
          <label className="text-sm font-medium">
            {t('fleets.name')}
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={200}
            />
          </label>
          <label className="text-sm font-medium">
            {t('fleets.code')}
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              maxLength={64}
              pattern="[A-Za-z0-9_-]+"
            />
          </label>
          <label className="text-sm font-medium sm:col-span-2">
            {t('fleets.description')}
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 sm:col-span-2 sm:w-fit"
          >
            {busy ? t('common.loading') : t('fleets.create')}
          </button>
        </form>

        {fleets.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">{t('fleets.emptyFleets')}</p>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead className="text-start text-slate-500">
              <tr>
                <th className="px-2 py-2 font-medium">{t('fleets.name')}</th>
                <th className="px-2 py-2 font-medium">{t('fleets.code')}</th>
                <th className="px-2 py-2 font-medium">{t('detail.status')}</th>
              </tr>
            </thead>
            <tbody>
              {fleets.map((fleet) => (
                <tr key={fleet.id} className="border-t border-slate-100">
                  <td className="px-2 py-2">{fleet.name}</td>
                  <td className="px-2 py-2 font-mono">{fleet.code}</td>
                  <td className="px-2 py-2">{fleet.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="overflow-x-auto rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="text-sm font-semibold">{t('fleets.devicesTitle')}</h2>
        {devices.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">{t('fleets.emptyDevices')}</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead className="text-start text-slate-500">
              <tr>
                <th className="px-2 py-2 font-medium">{t('fleets.colImei')}</th>
                <th className="px-2 py-2 font-medium">{t('fleets.colProtocol')}</th>
                <th className="px-2 py-2 font-medium">{t('fleets.colStatus')}</th>
                <th className="px-2 py-2 font-medium">{t('fleets.colFleet')}</th>
                <th className="px-2 py-2 font-medium">{t('tenants.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.id} className="border-t border-slate-100">
                  <td className="px-2 py-2 font-mono">{device.imei}</td>
                  <td className="px-2 py-2">{device.protocol}</td>
                  <td className="px-2 py-2">{device.status}</td>
                  <td className="px-2 py-2">{device.fleetName ?? t('fleets.unassigned')}</td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label={t('fleets.pickFleet')}
                        className="rounded-lg border border-slate-300 px-2 py-1"
                        value={choice[device.id] ?? ''}
                        onChange={(e) =>
                          setChoice((prev) => ({ ...prev, [device.id]: e.target.value }))
                        }
                      >
                        <option value="">{t('fleets.pickFleet')}</option>
                        {activeFleets.map((fleet) => (
                          <option key={fleet.id} value={fleet.id}>
                            {fleet.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="rounded-lg bg-brand-500 px-3 py-1 text-sm font-semibold text-white disabled:opacity-60"
                        disabled={!choice[device.id] || assigningId === device.id}
                        onClick={() => void onAssign(device)}
                      >
                        {t('fleets.assign')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
