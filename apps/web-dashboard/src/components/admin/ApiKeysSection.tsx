/**
 * ApiKeysSection — read-only list of the organisation's partner keys
 * (GET `/auth/api-keys`). Issuing and revoking keys is done in tenant
 * management.
 */
import { KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useApiKeys } from '@/api/admin.api';
import { ErrorState } from '@/components/common/ErrorState';
import { Alert, Badge, DataTable, EmptyState, type TableColumn } from '@/components/tailwind-ui';
import type { AdminApiKey } from '@/types/admin.types';

export function ApiKeysSection() {
  const { t } = useTranslation();
  const keys = useApiKeys();

  const columns: Array<TableColumn<AdminApiKey>> = [
    {
      id: 'name',
      headerKey: 'admin.apikeys.colName',
      sortBy: (k) => k.name,
      render: (k) => (
        <span className="font-medium text-gray-800 dark:text-graydark-800">{k.name}</span>
      ),
    },
    {
      id: 'prefix',
      headerKey: 'admin.apikeys.colPrefix',
      render: (k) => <span className="font-mono text-xs">{k.keyPrefix}</span>,
    },
    {
      id: 'scopes',
      headerKey: 'admin.apikeys.colScopes',
      render: (k) => (
        <span className="text-xs text-gray-500 dark:text-graydark-600">{k.scopes.join(', ')}</span>
      ),
    },
    {
      id: 'status',
      headerKey: 'admin.apikeys.colStatus',
      render: (k) => (
        <Badge color={k.status === 'ACTIVE' ? 'success' : 'gray'} dot>
          {k.status}
        </Badge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div data-testid="apikeys-managed-elsewhere">
        <Alert variant="info">{t('admin.apikeys.managedInTenantAdmin')}</Alert>
      </div>
      <DataTable
        rows={keys.data ?? []}
        columns={columns}
        rowKey={(k) => k.id}
        loading={keys.isLoading}
        maxHeight="calc(100vh - 280px)"
        errorState={
          keys.error ? (
            <ErrorState error={keys.error} onRetry={() => void keys.refetch()} />
          ) : undefined
        }
        emptyState={
          <EmptyState
            icon={<KeyRound />}
            title={t('admin.empty')}
            description={t('admin.apikeys.empty')}
          />
        }
      />
    </div>
  );
}
