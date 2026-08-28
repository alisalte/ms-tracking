/**
 * ApiKeysSection — list / create / revoke partner keys (GET/POST/DELETE
 * `/auth/api-keys`). The plaintext secret is shown once after create.
 */
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/api/admin.api';
import { ErrorState } from '@/components/common/ErrorState';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { useToast } from '@/components/feedback/ToastProvider';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Input,
  Modal,
  type TableColumn,
} from '@/components/tailwind-ui';
import type { AdminApiKey } from '@/types/admin.types';

export function ApiKeysSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const keys = useApiKeys();
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState('tracking.read');
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);

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
    {
      id: 'actions',
      headerKey: 'admin.users.actions',
      align: 'end',
      render: (k) => (
        <Button
          size="sm"
          variant="ghost"
          className="text-danger-600"
          leftIcon={<Trash2 size={14} />}
          onClick={() => setRevokeId(k.id)}
        >
          {t('admin.apikeys.revoke')}
        </Button>
      ),
    },
  ];

  const submit = () => {
    const trimmed = name.trim();
    const scopeList = scopes
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (trimmed.length < 1 || scopeList.length === 0) return;
    create.mutate(
      { name: trimmed, scopes: scopeList },
      {
        onSuccess: (created) => {
          toast.success('admin.apikeys.toastCreated');
          setPlaintext(created.key);
          setName('');
          setScopes('tracking.read');
          setOpen(false);
        },
        onError: (err) => toast.error(err),
      },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end">
        <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setOpen(true)}>
          {t('admin.apikeys.create')}
        </Button>
      </div>
      {plaintext && (
        <Alert variant="warning" title={t('admin.apikeys.plaintextTitle')}>
          <code className="break-all font-mono text-xs">{plaintext}</code>
          <p className="mt-1 text-xs">{t('admin.apikeys.plaintextHelp')}</p>
        </Alert>
      )}
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

      <Modal
        open={open}
        onClose={() => {
          if (create.isPending) return;
          setOpen(false);
        }}
        title={t('admin.apikeys.createTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={create.isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={submit}
              disabled={name.trim().length < 1 || create.isPending}
              loading={create.isPending}
            >
              {t('admin.apikeys.createSubmit')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {create.isError && <Alert variant="danger">{create.error.message}</Alert>}
          <Input
            label={t('admin.apikeys.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <Input
            label={t('admin.apikeys.scopes')}
            value={scopes}
            onChange={(e) => setScopes(e.target.value)}
            hint={t('admin.apikeys.scopesHint')}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(revokeId)}
        title={t('admin.apikeys.confirmRevokeTitle')}
        message={t('admin.apikeys.confirmRevokeMessage')}
        confirmLabelKey="admin.apikeys.revoke"
        tone="danger"
        loading={revoke.isPending}
        onClose={() => setRevokeId(null)}
        onConfirm={() => {
          if (!revokeId) return;
          revoke.mutate(revokeId, {
            onSuccess: () => toast.success('admin.apikeys.toastRevoked'),
            onError: (err) => toast.error(err),
          });
          setRevokeId(null);
        }}
      />
    </div>
  );
}
