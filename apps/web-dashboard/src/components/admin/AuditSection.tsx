/**
 * AuditSection — the immutable audit log (Audit-Compliance-Log §3.1 AuditEntry).
 *
 * Filterable by action/category + search; shows actor, target, service,
 * correlation id, and the chain integrity hash. Includes an export action
 * (§5.1 `/export`) and an integrity-verify indicator (§5.1 `/integrity/status`).
 */
import { Download, ScrollText, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuditEntries, useExportAudit } from '@/api/admin.api';
import { auditActionColor } from '@/components/admin/admin-meta';
import { ErrorState } from '@/components/common/ErrorState';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Select,
  type TableColumn,
  Toolbar,
  Tooltip,
} from '@/components/tailwind-ui';
import { displayLabel } from '@/lib/ids';
import type { AuditAction, AuditCategory, AuditEntry } from '@/types/admin.types';

const ACTIONS: Array<AuditAction | 'all'> = [
  'all',
  'create',
  'update',
  'delete',
  'login',
  'logout',
  'authorize',
  'deny',
  'config_change',
  'system',
];
const CATEGORIES: Array<AuditCategory | 'all'> = [
  'all',
  'authentication',
  'authorization',
  'fleet',
  'vehicle',
  'driver',
  'trip',
  'fuel',
  'maintenance',
  'compliance',
  'billing',
  'tenant',
  'system',
];

export function AuditSection() {
  const { t } = useTranslation();
  const { data: entries, isLoading, error, refetch } = useAuditEntries();
  const exportAudit = useExportAudit();
  const [action, setAction] = useState<AuditAction | 'all'>('all');
  const [category, setCategory] = useState<AuditCategory | 'all'>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (entries ?? []).filter((e) => {
      if (action !== 'all' && e.action !== action) return false;
      if (category !== 'all' && e.category !== category) return false;
      if (!q) return true;
      return (
        e.actorName.toLowerCase().includes(q) ||
        e.targetType.toLowerCase().includes(q) ||
        e.correlationId.toLowerCase().includes(q)
      );
    });
  }, [entries, action, category, query]);

  const columns: Array<TableColumn<AuditEntry>> = [
    {
      id: 'time',
      headerKey: 'admin.audit.colTime',
      sortBy: (e) => e.timestamp,
      render: (e) => (
        <span className="text-xs text-gray-500 dark:text-graydark-600">
          {new Date(e.timestamp).toLocaleString()}
        </span>
      ),
    },
    {
      id: 'action',
      headerKey: 'admin.audit.colAction',
      sortBy: (e) => e.action,
      render: (e) => (
        <Badge color={auditActionColor(e.action)} dot>
          {t(`admin.audit.action.${e.action}`)}
        </Badge>
      ),
    },
    {
      id: 'actor',
      headerKey: 'admin.audit.colActor',
      sortBy: (e) => e.actorName,
      render: (e) => (
        <div className="flex flex-col">
          <span className="font-medium text-gray-800 dark:text-graydark-800">{e.actorName}</span>
          <span className="text-xs text-gray-500 dark:text-graydark-600">{e.actorType}</span>
        </div>
      ),
    },
    {
      id: 'target',
      headerKey: 'admin.audit.colTarget',
      render: (e) => {
        const targetTitle = displayLabel(e.targetId, e.targetType);
        return (
          <div className="flex flex-col">
            <span className="text-sm">{e.targetType}</span>
            {targetTitle && targetTitle !== e.targetType && (
              <span className="text-xs text-gray-500 dark:text-graydark-600">{targetTitle}</span>
            )}
          </div>
        );
      },
    },
    {
      id: 'service',
      headerKey: 'admin.audit.colService',
      render: (e) => (
        <span className="text-xs text-gray-500 dark:text-graydark-600">{e.sourceService}</span>
      ),
    },
    {
      id: 'hash',
      headerKey: 'admin.audit.colHash',
      render: (e) => (
        <Tooltip label={e.integrityHash}>
          <span className="cursor-help font-mono text-[0.6rem] text-gray-500 dark:text-graydark-600">
            {e.integrityHash.slice(0, 16)}…
          </span>
        </Tooltip>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* Filters + actions */}
      <Toolbar
        search
        searchValue={query}
        onSearchChange={setQuery}
        searchPlaceholder={t('admin.audit.search')}
        left={
          <>
            <Select
              value={action}
              onChange={(e) => setAction(e.target.value as AuditAction | 'all')}
              wrapperClassName="w-36"
              aria-label={t('admin.audit.allActions')}
              options={ACTIONS.map((a) => ({
                value: a,
                label: a === 'all' ? t('admin.audit.allActions') : t(`admin.audit.action.${a}`),
              }))}
            />
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value as AuditCategory | 'all')}
              wrapperClassName="w-40"
              aria-label={t('admin.audit.allCategories')}
              options={CATEGORIES.map((c) => ({
                value: c,
                label:
                  c === 'all' ? t('admin.audit.allCategories') : t(`admin.audit.category.${c}`),
              }))}
            />
          </>
        }
        right={
          <>
            {/* Honest chain label — every row carries a hash-chained integrity
                hash; a live /integrity/status verdict does not exist yet, so
                we state what is true instead of a fabricated "verified ✓". */}
            <Tooltip label={t('admin.audit.chainTooltip')}>
              <Badge color="gray">
                <ShieldCheck size={12} aria-hidden />
                {t('admin.audit.chainLabel')}
              </Badge>
            </Tooltip>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<Download size={15} />}
              disabled={exportAudit.isPending || filtered.length === 0}
              onClick={() => exportAudit.mutate({ entries: filtered })}
            >
              {exportAudit.isPending ? t('admin.audit.exporting') : t('admin.audit.export')}
            </Button>
          </>
        }
      />

      {/* Table — a failed fetch renders the error state, never an empty table */}
      <DataTable
        rows={filtered}
        columns={columns}
        rowKey={(e) => e.id}
        loading={isLoading}
        maxHeight="calc(100vh - 280px)"
        errorState={error ? <ErrorState error={error} onRetry={() => void refetch()} /> : undefined}
        emptyState={
          <EmptyState
            icon={<ScrollText />}
            title={t('admin.empty')}
            description={t('admin.audit.emptyDescription')}
          />
        }
      />
    </div>
  );
}
