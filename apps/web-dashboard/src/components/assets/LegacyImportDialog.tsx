/**
 * LegacyImportDialog — move units from the previous tracking system.
 *
 * Accepts the old system's "objects" CSV or a Wialon "Units" export. Shows what
 * was read, lets the operator choose which legacy groups become fleets, then
 * upserts every unit by IMEI in batches (`POST /vehicles/legacy-import`):
 * a tracker already in the registry keeps its history and its placeholder
 * vehicle is renamed, so the import can safely be run again.
 */
import { useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type LegacyImportRowResult, postLegacyImport } from '@/api/asset.api';
import { queryKeys } from '@/api/query-keys';
import { Alert, Button, Modal } from '@/components/tailwind-ui';
import {
  LegacyFileError,
  type LegacyProtocol,
  type ParsedLegacyFile,
  assignFleets,
  legacyProtocolForModel,
  parseLegacyFile,
  toLegacyImportRows,
} from '@/lib/legacy-units';

const BATCH = 200;
const PROTOCOLS: LegacyProtocol[] = ['teltonika', 'meitrack', 'gt06', 'jt808'];

export function LegacyImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fileId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedLegacyFile | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fleetGroups, setFleetGroups] = useState<Set<string>>(new Set());
  const [fallback, setFallback] = useState('');
  const [defaultProtocol, setDefaultProtocol] = useState<LegacyProtocol | ''>('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<LegacyImportRowResult[] | null>(null);
  const [fleetsCreated, setFleetsCreated] = useState<string[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const running = progress !== null && results === null;

  const fallbackName = fallback.trim() || t('assets.legacy.defaultFleet');
  const badRows = useMemo(() => new Set(parsed?.issues.map((i) => i.row)), [parsed]);
  const valid = useMemo(
    () => (parsed ? parsed.units.filter((u) => !badRows.has(u.row)) : []),
    [parsed, badRows],
  );
  const fleets = useMemo(
    () => assignFleets(valid, fleetGroups, fallbackName),
    [valid, fleetGroups, fallbackName],
  );
  const fleetCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of fleets.values()) m.set(f, (m.get(f) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [fleets]);
  const noProtocol = useMemo(
    () => valid.filter((u) => !legacyProtocolForModel(u.model)).length,
    [valid],
  );

  const reset = () => {
    setFileName(null);
    setParsed(null);
    setParseError(null);
    setFleetGroups(new Set());
    setProgress(null);
    setResults(null);
    setFleetsCreated([]);
    setRunError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const close = () => {
    if (running) return;
    reset();
    onClose();
  };

  const onFile = async (file: File | undefined) => {
    reset();
    if (!file) return;
    setFileName(file.name);
    try {
      const p = await parseLegacyFile(file);
      setParsed(p);
      // The objects export has one group per unit: every group is a fleet.
      setFleetGroups(new Set(p.format === 'objects' ? p.groups.map((g) => g.name) : []));
    } catch (err) {
      setParseError(
        err instanceof LegacyFileError
          ? t(`assets.legacy.errors.${err.code}`)
          : t('assets.import.parseError'),
      );
    }
  };

  const run = async () => {
    const rows = toLegacyImportRows(valid, fleets, fallbackName);
    const out: LegacyImportRowResult[] = [];
    const created = new Set<string>();
    setRunError(null);
    setProgress({ done: 0, total: rows.length });
    try {
      for (let i = 0; i < rows.length; i += BATCH) {
        const r = await postLegacyImport(rows.slice(i, i + BATCH), defaultProtocol || undefined);
        out.push(...r.rows);
        for (const f of r.fleetsCreated) created.add(f);
        setProgress({ done: Math.min(i + BATCH, rows.length), total: rows.length });
      }
    } catch (err) {
      setRunError((err as Error)?.message ?? String(err));
    } finally {
      setFleetsCreated([...created]);
      setResults(out);
      void qc.invalidateQueries({ queryKey: queryKeys.assets.all });
    }
  };

  const toggle = (g: string) =>
    setFleetGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  const failedRows = results?.filter((r) => r.outcome === 'FAILED') ?? [];
  const warnRows = results?.filter((r) => r.outcome !== 'FAILED' && r.warnings.length > 0) ?? [];

  return (
    <Modal
      open={open}
      onClose={close}
      closeOnBackdrop={!running}
      size="xl"
      title={t('assets.legacy.title')}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={close} disabled={running}>
            {results ? t('common.close') : t('common.cancel')}
          </Button>
          {!results && (
            <Button
              size="sm"
              leftIcon={<Upload size={15} />}
              disabled={!parsed || valid.length === 0 || running}
              loading={running}
              onClick={run}
            >
              {t('assets.legacy.submit', { count: valid.length })}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm" data-testid="legacy-import">
        <p className="text-gray-600 dark:text-graydark-700">{t('assets.legacy.subtitle')}</p>

        <label
          htmlFor={fileId}
          className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-gray-300 p-4 hover:border-brand-400 dark:border-white/15"
        >
          <FileSpreadsheet size={22} className="text-brand-500" aria-hidden />
          <span className="flex flex-col">
            <span className="font-semibold">{fileName ?? t('assets.legacy.chooseFile')}</span>
            <span className="text-xs text-gray-500">{t('assets.legacy.accepts')}</span>
          </span>
          <input
            id={fileId}
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            disabled={running}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>

        {parseError && <Alert variant="danger">{parseError}</Alert>}

        {parsed && !results && (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-brand-50 px-2.5 py-1 font-semibold text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                {t(`assets.legacy.format.${parsed.format}`)}
              </span>
              <span className="rounded-full bg-gray-100 px-2.5 py-1 dark:bg-white/5">
                {t('assets.legacy.unitsRead', { count: parsed.units.length })}
              </span>
              {parsed.issues.length > 0 && (
                <span className="rounded-full bg-warning-50 px-2.5 py-1 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400">
                  {t('assets.legacy.unitsSkipped', { count: badRows.size })}
                </span>
              )}
            </div>

            {parsed.issues.length > 0 && (
              <details className="rounded-lg border border-gray-200 p-3 text-xs dark:border-white/10">
                <summary className="cursor-pointer">{t('assets.legacy.issuesTitle')}</summary>
                <ul className="mt-2 max-h-40 overflow-auto">
                  {parsed.issues.map((i) => {
                    const u = parsed.units.find((x) => x.row === i.row);
                    return (
                      <li key={`${i.row}-${i.code}`} className="py-0.5">
                        {t('assets.import.row', { row: i.row })} · {u?.name || '—'} ·{' '}
                        {t(`assets.legacy.issues.${i.code}`)}
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{t('assets.legacy.groupsTitle')}</h3>
              <p className="text-xs text-gray-500">{t('assets.legacy.groupsHint')}</p>
              <div className="grid max-h-56 grid-cols-1 gap-1 overflow-auto rounded-lg border border-gray-200 p-2 sm:grid-cols-2 dark:border-white/10">
                {parsed.groups.map((g) => (
                  <label key={g.name} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={fleetGroups.has(g.name)}
                      onChange={() => toggle(g.name)}
                    />
                    <span className="truncate">{g.name}</span>
                    <span className="ms-auto text-gray-500">{g.count}</span>
                  </label>
                ))}
              </div>
              <label className="flex flex-wrap items-center gap-2 text-xs">
                {t('assets.legacy.fallback')}
                <input
                  value={fallback}
                  placeholder={t('assets.legacy.defaultFleet')}
                  onChange={(e) => setFallback(e.target.value)}
                  className="h-8 min-w-48 rounded-lg border border-gray-300 bg-transparent px-2 dark:border-white/10"
                />
              </label>
              <div className="flex flex-wrap gap-1.5 text-xs" data-testid="legacy-fleet-preview">
                {fleetCounts.map(([name, count]) => (
                  <span key={name} className="rounded-md bg-gray-100 px-2 py-0.5 dark:bg-white/5">
                    {name}: {count}
                  </span>
                ))}
              </div>
            </section>

            {noProtocol > 0 && (
              <label className="flex flex-wrap items-center gap-2 text-xs">
                {t('assets.legacy.unknownModels', { count: noProtocol })}
                <select
                  value={defaultProtocol}
                  onChange={(e) => setDefaultProtocol(e.target.value as LegacyProtocol | '')}
                  className="h-8 rounded-lg border border-gray-300 bg-transparent px-2 dark:border-white/10"
                >
                  <option value="">{t('assets.legacy.skipUnknown')}</option>
                  {PROTOCOLS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <p className="text-xs text-gray-500">{t('assets.legacy.upsertNote')}</p>
          </>
        )}

        {progress && !results && (
          // biome-ignore lint/a11y/useSemanticElements: live progress region.
          <div role="status" className="flex flex-col gap-1">
            <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
              <div
                className="h-full bg-brand-500 transition-all"
                style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }}
              />
            </div>
            <span className="text-xs text-gray-500">
              {t('assets.legacy.progress', { done: progress.done, total: progress.total })}
            </span>
          </div>
        )}

        {results && (
          <div className="flex flex-col gap-3" data-testid="legacy-import-result">
            {runError && <Alert variant="danger">{runError}</Alert>}
            <div className="grid grid-cols-3 gap-2 text-center">
              <Count label={t('assets.legacy.created')} value={count(results, 'CREATED')} />
              <Count label={t('assets.legacy.updated')} value={count(results, 'UPDATED')} />
              <Count label={t('assets.legacy.failed')} value={failedRows.length} />
            </div>
            {fleetsCreated.length > 0 && (
              <p className="text-xs">
                {t('assets.legacy.fleetsCreated', { names: fleetsCreated.join('، ') })}
              </p>
            )}
            {failedRows.length > 0 && (
              <ResultList
                title={t('assets.legacy.failedTitle')}
                rows={failedRows.map((r) => ({ key: `f${r.row}`, r, text: r.error ?? '' }))}
              />
            )}
            {warnRows.length > 0 && (
              <ResultList
                title={t('assets.legacy.warningsTitle')}
                rows={warnRows.map((r) => ({ key: `w${r.row}`, r, text: r.warnings.join(' ') }))}
              />
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function count(rows: LegacyImportRowResult[], outcome: LegacyImportRowResult['outcome']) {
  return rows.filter((r) => r.outcome === outcome).length;
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-200 p-3 dark:border-white/10">
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function ResultList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ key: string; r: LegacyImportRowResult; text: string }>;
}) {
  const { t } = useTranslation();
  return (
    <details open className="rounded-lg border border-gray-200 p-3 text-xs dark:border-white/10">
      <summary className="cursor-pointer font-semibold">
        {title} ({rows.length})
      </summary>
      <ul className="mt-2 max-h-48 overflow-auto">
        {rows.map(({ key, r, text }) => (
          <li
            key={key}
            className="border-b border-gray-100 py-1 last:border-b-0 dark:border-white/5"
          >
            {t('assets.import.row', { row: r.row })} · {r.name ?? '—'} ·{' '}
            <span dir="ltr">{r.imei ?? ''}</span> — {text}
          </li>
        ))}
      </ul>
    </details>
  );
}
