/**
 * Driver ranking view — Sprint 2 behavior ranking (lowest score first).
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Trophy } from 'lucide-react';

import {
  type DriverBehaviorRankingRow,
  useDriverBehaviorRanking,
} from '@/api/driver.api';
import {
  Badge,
  DataTable,
  EmptyState,
  Spinner,
  type TableColumn,
  Toolbar,
} from '@/components/tailwind-ui';

interface DriverRankingPanelProps {
  selectedId?: string | null;
  onSelect: (id: string) => void;
  query: string;
  onQuery: (q: string) => void;
}

export function DriverRankingPanel({
  selectedId,
  onSelect,
  query,
  onQuery,
}: DriverRankingPanelProps) {
  const { t } = useTranslation();
  const { data = [], isLoading, isError, refetch } = useDriverBehaviorRanking();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data;
    return data.filter((r) =>
      `${r.firstName} ${r.lastName}`.toLowerCase().includes(q),
    );
  }, [data, query]);

  const columns: Array<TableColumn<DriverBehaviorRankingRow>> = [
    {
      id: 'rank',
      headerKey: 'assets.driver.colRank',
      sortBy: (r) => r.rank,
      render: (r) => (
        <span className="tabular-nums font-medium text-gray-700 dark:text-gray-200">#{r.rank}</span>
      ),
    },
    {
      id: 'name',
      headerKey: 'assets.driver.colName',
      sortBy: (r) => `${r.firstName} ${r.lastName}`,
      render: (r) => (
        <span className="font-medium text-gray-800 dark:text-graydark-800">
          {`${r.firstName} ${r.lastName}`.trim()}
        </span>
      ),
    },
    {
      id: 'score',
      headerKey: 'assets.driver.colScore',
      sortBy: (r) => r.score,
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className="tabular-nums text-lg font-semibold">{Math.round(r.score)}</span>
          {r.needsAttention && (
            <Badge color="warning">
              <span className="inline-flex items-center gap-1">
                <AlertTriangle size={12} />
                {t('assets.driver.needsAttention')}
              </span>
            </Badge>
          )}
        </div>
      ),
    },
    {
      id: 'events',
      headerKey: 'assets.driver.colBehaviorEvents',
      render: (r) => (
        <span className="text-xs text-gray-600 dark:text-gray-300">
          {t('assets.driver.rankingEventSummary', {
            brake: r.harshBrakeCount,
            accel: r.rapidAccelCount,
            speed: r.speedViolationCount,
            idle: r.excessiveIdleCount,
          })}
        </span>
      ),
    },
  ];

  if (isError) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-lg border border-danger-200 p-4 text-sm dark:border-danger-800">
        <p>{t('assets.driver.rankingError')}</p>
        <button type="button" className="text-brand-600 underline" onClick={() => refetch()}>
          {t('common.retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">{t('assets.driver.rankingHint')}</p>
      <Toolbar
        search
        searchValue={query}
        onSearchChange={onQuery}
        searchPlaceholder={t('assets.driver.search')}
        right={
          <span className="text-xs text-gray-500 dark:text-graydark-600">
            {t('assets.count', { count: filtered.length })}
          </span>
        }
      />
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(r) => r.driverId}
          selectedKey={selectedId}
          onRowClick={(r) => onSelect(r.driverId)}
          maxHeight="calc(100vh - 340px)"
          emptyState={
            <EmptyState
              icon={<Trophy />}
              title={t('assets.driver.rankingEmpty')}
              description={t('assets.driver.rankingEmptyHint')}
            />
          }
        />
      )}
    </div>
  );
}
