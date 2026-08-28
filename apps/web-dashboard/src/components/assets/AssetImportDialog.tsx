/**
 * AssetImportDialog — Excel/CSV import for vehicles or devices (`/assets`).
 *
 * Template download + file parse (client-side preview/validation) + POST
 * `/vehicles/import` or `/devices/import`. Partial success is shown per row.
 */
import { useCallback, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useImportDevices, useImportVehicles } from '@/api/asset.api';
import { useToast } from '@/components/feedback/ToastProvider';
import { Alert, Button, Modal } from '@/components/tailwind-ui';
import {
  ASSET_IMPORT_MAX_ROWS,
  type AssetImportKind,
  type DeviceImportDraft,
  type ImportRowIssue,
  type ParsedAssetImport,
  SpreadsheetParseError,
  type VehicleImportDraft,
  buildAssetImportTemplate,
  parseAssetImportFile,
} from '@/lib/asset-import';
import { downloadBlob } from '@/lib/video-stream';
import type { AssetImportFailure } from '@/types/asset.types';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';

export interface AssetImportDialogProps {
  open: boolean;
  kind: AssetImportKind;
  onClose: () => void;
}

type Parsed = ParsedAssetImport<VehicleImportDraft> | ParsedAssetImport<DeviceImportDraft> | null;

export function AssetImportDialog({ open, kind, onClose }: AssetImportDialogProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const fileId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const importVehicles = useImportVehicles();
  const importDevices = useImportDevices();
  const importing = importVehicles.isPending || importDevices.isPending;

  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    created: number;
    failed: AssetImportFailure[];
    warnings: AssetImportFailure[];
  } | null>(null);

  const reset = useCallback(() => {
    setFileName(null);
    setParsed(null);
    setParseError(null);
    setResult(null);
    importVehicles.reset();
    importDevices.reset();
    if (inputRef.current) inputRef.current.value = '';
  }, [importDevices, importVehicles]);

  const handleClose = () => {
    if (importing) return;
    reset();
    onClose();
  };

  const downloadTemplate = () => {
    const { blob, filename } = buildAssetImportTemplate(kind);
    downloadBlob(blob, filename);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setResult(null);
    setParseError(null);
    setFileName(file.name);
    try {
      const next = await parseAssetImportFile(file, kind);
      setParsed(next);
    } catch (err) {
      setParsed(null);
      const msg =
        err instanceof SpreadsheetParseError ? err.message : t('assets.import.parseError');
      setParseError(msg);
    }
  };

  const fileIssues = parsed?.issues.filter((i) => i.row <= 1) ?? [];
  const rowIssues = parsed?.issues.filter((i) => i.row > 1) ?? [];
  const blockedRows = new Set(rowIssues.map((i) => i.row));
  const readyRows = (parsed?.rows ?? []).filter((r) => !blockedRows.has(r.row));
  const canSubmit = readyRows.length > 0 && fileIssues.length === 0 && !result;

  const submit = async () => {
    if (!canSubmit) return;
    try {
      const payload = readyRows.map((r) => {
        if (kind === 'vehicles') {
          const v = r as VehicleImportDraft;
          return {
            row: v.row,
            name: v.name,
            code: v.code,
            fleetCode: v.fleetCode,
            ...(v.plate ? { plate: v.plate } : {}),
            ...(v.vin ? { vin: v.vin } : {}),
          };
        }
        const d = r as DeviceImportDraft;
        return {
          row: d.row,
          imei: d.imei,
          protocol: d.protocol,
          ...(d.serialNumber ? { serialNumber: d.serialNumber } : {}),
          ...(d.manufacturer ? { manufacturer: d.manufacturer } : {}),
          ...(d.model ? { model: d.model } : {}),
          ...(d.vehicleCode ? { vehicleCode: d.vehicleCode } : {}),
        };
      });
      const res =
        kind === 'vehicles'
          ? await importVehicles.mutateAsync(payload as VehicleImportDraft[])
          : await importDevices.mutateAsync(payload as DeviceImportDraft[]);
      setResult({
        created: res.created.length,
        failed: res.failed ?? [],
        warnings: res.warnings ?? [],
      });
      if (res.failed.length === 0 && (res.warnings?.length ?? 0) === 0) {
        toast.success(t('assets.import.resultCreated', { count: res.created.length }));
      }
    } catch (err) {
      toast.error(err);
    }
  };

  const issueLabel = (issue: ImportRowIssue) => {
    const key = `assets.import.errors.${issue.code}`;
    const translated = t(key, { max: ASSET_IMPORT_MAX_ROWS });
    return translated === key ? issue.code : translated;
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      closeOnBackdrop={!importing}
      size="lg"
      title={t(kind === 'vehicles' ? 'assets.import.titleVehicles' : 'assets.import.titleDevices')}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={handleClose} disabled={importing}>
            {result ? t('common.close') : t('common.cancel')}
          </Button>
          {!result && (
            <Button
              size="sm"
              onClick={() => void submit()}
              disabled={!canSubmit}
              loading={importing}
            >
              {t('assets.import.submit', { count: readyRows.length })}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-600 dark:text-graydark-700">
          {t('assets.import.subtitle')}
        </p>
        <Alert variant="info">{t(`assets.import.hints.${kind}`)}</Alert>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Download size={15} />}
            onClick={downloadTemplate}
            type="button"
          >
            {t('assets.import.downloadTemplate')}
          </Button>
        </div>

        <label
          htmlFor={fileId}
          className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-600 hover:border-brand-400 hover:bg-brand-50/40 dark:border-white/10 dark:bg-white/5 dark:text-graydark-700 dark:hover:border-brand-400/60"
        >
          <FileSpreadsheet size={22} className="text-brand-500" />
          <span className="font-medium text-gray-800 dark:text-white">
            <Upload size={14} className="me-1 inline" />
            {t('assets.import.chooseFile')}
          </span>
          <span className="text-xs text-gray-500 dark:text-graydark-600">
            {t('assets.import.dropHint')}
          </span>
          {fileName && (
            <span className="text-xs font-medium text-brand-600 dark:text-brand-400">
              {fileName}
            </span>
          )}
          <input
            ref={inputRef}
            id={fileId}
            type="file"
            className="sr-only"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>

        {parseError && (
          <Alert variant="danger" title={t('assets.import.parseError')}>
            {parseError}
          </Alert>
        )}

        {parsed && fileIssues.length > 0 && (
          <Alert variant="danger">
            {fileIssues.map((i) => (
              <div key={`${i.row}-${i.code}`}>{issueLabel(i)}</div>
            ))}
          </Alert>
        )}

        {parsed && fileIssues.length === 0 && (
          <>
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="text-success-700 dark:text-success-400">
                {t('assets.import.rowsReady', { count: readyRows.length })}
              </span>
              {rowIssues.length > 0 && (
                <span className="text-danger-600 dark:text-danger-400">
                  {t('assets.import.rowsInvalid', { count: rowIssues.length })}
                </span>
              )}
            </div>
            <PreviewTable kind={kind} rows={parsed.rows.slice(0, 8)} blocked={blockedRows} />
            {rowIssues.length > 0 && (
              <ul className="max-h-40 overflow-auto rounded-lg border border-danger-100 bg-danger-50/50 p-3 text-xs text-danger-700 dark:border-danger-500/20 dark:bg-danger-500/10 dark:text-danger-400">
                {rowIssues.slice(0, 20).map((i) => (
                  <li key={`${i.row}-${i.field}-${i.code}`}>
                    {t('assets.import.row', { row: i.row })} — {issueLabel(i)}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {result && (
          <Alert
            variant={result.failed.length === 0 ? 'success' : 'warning'}
            title={t('assets.import.resultCreated', { count: result.created })}
          >
            {result.failed.length > 0 && (
              <p>{t('assets.import.resultFailed', { count: result.failed.length })}</p>
            )}
            {result.warnings.length > 0 && (
              <ul className="mt-2 space-y-1">
                {result.warnings.map((w) => (
                  <li key={`w-${w.row}`}>
                    {t('assets.import.row', { row: w.row })} — {w.error}
                  </li>
                ))}
              </ul>
            )}
            {result.failed.length > 0 && (
              <ul className="mt-2 max-h-40 space-y-1 overflow-auto">
                {result.failed.map((f) => (
                  <li key={`f-${f.row}`}>
                    {t('assets.import.row', { row: f.row })} — {f.error}
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        )}
      </div>
    </Modal>
  );
}

function PreviewTable({
  kind,
  rows,
  blocked,
}: {
  kind: AssetImportKind;
  rows: Array<VehicleImportDraft | DeviceImportDraft>;
  blocked: Set<number>;
}) {
  const { t } = useTranslation();
  if (rows.length === 0) return null;
  const cols =
    kind === 'vehicles'
      ? (['name', 'code', 'fleetCode', 'plate', 'vin'] as const)
      : (['imei', 'protocol', 'serialNumber', 'manufacturer', 'model', 'vehicleCode'] as const);
  return (
    <div className="overflow-auto rounded-lg border border-gray-200 dark:border-white/10">
      <table className="min-w-full text-start text-xs">
        <thead className="bg-gray-50 text-gray-500 dark:bg-white/5 dark:text-graydark-600">
          <tr>
            <th className="px-2 py-1.5 font-medium">{t('assets.import.colRow')}</th>
            {cols.map((c) => (
              <th key={c} className="px-2 py-1.5 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.row}
              className={
                blocked.has(r.row)
                  ? 'bg-danger-50/80 text-danger-700 dark:bg-danger-500/10 dark:text-danger-400'
                  : 'text-gray-800 dark:text-graydark-800'
              }
            >
              <td className="px-2 py-1.5 font-mono">{r.row}</td>
              {cols.map((c) => (
                <td key={c} className="max-w-[10rem] truncate px-2 py-1.5">
                  {String((r as unknown as Record<string, string | undefined>)[c] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
