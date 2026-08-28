/**
 * UsersSection — the Users & Roles table (UI_UX §5.3 wireframe).
 *
 * Columns: name, email, role, MFA, last-login. Filter by status + search.
 * Row click opens the user detail drawer (selection → detail, UI_UX §0.6).
 */
import { Check, Plus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCreateUser } from '@/api/admin.api';
import { userStatusColor } from '@/components/admin/admin-meta';
import { useToast } from '@/components/feedback/ToastProvider';
import { PasswordTextField } from '@/components/form/PasswordTextField';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Input,
  Modal,
  Select,
  type TableColumn,
  Toolbar,
} from '@/components/tailwind-ui';
import { relativeTime } from '@/lib/relative-time';
import { emailSchema, passwordSchema, usernameSchema } from '@/lib/validation';
import type { AdminUser, AdminUserStatus } from '@/types/admin.types';

interface UsersSectionProps {
  users: AdminUser[];
  loading?: boolean;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  filterStatus: AdminUserStatus | 'all';
  query: string;
  onFilterStatus: (s: AdminUserStatus | 'all') => void;
  onQuery: (q: string) => void;
}

const STATUSES: Array<AdminUserStatus | 'all'> = [
  'all',
  'active',
  'suspended',
  'deactivated',
  'locked',
];

export function UsersSection({
  users,
  loading = false,
  selectedId,
  onSelect,
  filterStatus,
  query,
  onFilterStatus,
  onQuery,
}: UsersSectionProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const create = useCreateUser();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const resetForm = () => {
    setEmail('');
    setUsername('');
    setDisplayName('');
    setPassword('');
    setFormError(null);
  };

  const submitCreate = () => {
    const parsedEmail = emailSchema.safeParse(email);
    const parsedUser = usernameSchema.safeParse(username);
    const parsedPass = passwordSchema.safeParse(password);
    if (!parsedEmail.success) {
      setFormError(t(parsedEmail.error.issues[0]?.message ?? 'validation.email.invalid'));
      return;
    }
    if (!parsedUser.success) {
      setFormError(t(parsedUser.error.issues[0]?.message ?? 'validation.username.tooShort'));
      return;
    }
    if (!parsedPass.success) {
      setFormError(t(parsedPass.error.issues[0]?.message ?? 'validation.password.tooShort'));
      return;
    }
    setFormError(null);
    create.mutate(
      {
        email: parsedEmail.data,
        username: parsedUser.data,
        password: parsedPass.data,
        displayName: displayName.trim() || undefined,
      },
      {
        onSuccess: (user) => {
          toast.success('admin.users.toastCreated');
          setOpen(false);
          resetForm();
          onSelect(user.id);
        },
        onError: (err) => toast.error(err),
      },
    );
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (filterStatus !== 'all' && u.status !== filterStatus) return false;
      if (!q) return true;
      return (
        `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q)
      );
    });
  }, [users, filterStatus, query]);

  const columns: Array<TableColumn<AdminUser>> = [
    {
      id: 'name',
      headerKey: 'admin.users.colName',
      sortBy: (u) => `${u.firstName} ${u.lastName}`.toLowerCase(),
      render: (u) => (
        <div className="flex flex-col">
          <span className="font-medium text-gray-800 dark:text-graydark-800">
            {u.firstName} {u.lastName}
          </span>
          <span className="text-xs text-gray-500 dark:text-graydark-600">{u.email}</span>
        </div>
      ),
    },
    {
      id: 'role',
      headerKey: 'admin.users.colRole',
      sortBy: (u) => u.roleName,
      render: (u) => <span className="text-sm">{u.roleName}</span>,
    },
    {
      id: 'mfa',
      headerKey: 'admin.users.colMfa',
      render: (u) =>
        u.mfaEnabled ? (
          <Badge color="success">
            <Check size={12} aria-hidden />
            <span className="sr-only">{t('admin.users.mfaOn')}</span>
          </Badge>
        ) : (
          <span className="text-gray-400 dark:text-graydark-600">—</span>
        ),
    },
    {
      id: 'status',
      headerKey: 'admin.users.colStatus',
      sortBy: (u) => u.status,
      render: (u) => (
        <Badge color={userStatusColor(u.status)} dot>
          {t(`admin.users.status.${u.status}`)}
        </Badge>
      ),
    },
    {
      id: 'lastLogin',
      headerKey: 'admin.users.colLastLogin',
      align: 'end',
      sortBy: (u) => u.lastLoginAt ?? '',
      render: (u) => (
        <span className="text-xs text-gray-500 dark:text-graydark-600">
          {u.lastLoginAt ? relativeTime(u.lastLoginAt, t) : '—'}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <Toolbar
        search
        searchValue={query}
        onSearchChange={onQuery}
        searchPlaceholder={t('admin.users.search')}
        left={
          <Select
            value={filterStatus}
            onChange={(e) => onFilterStatus(e.target.value as AdminUserStatus | 'all')}
            wrapperClassName="w-40"
            aria-label={t('admin.users.colStatus')}
            options={STATUSES.map((s) => ({
              value: s,
              label: s === 'all' ? t('admin.users.allStatus') : t(`admin.users.status.${s}`),
            }))}
          />
        }
        right={
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-graydark-600">
              {t('admin.count', { count: filtered.length })}
            </span>
            <Button
              size="sm"
              leftIcon={<Plus size={14} />}
              onClick={() => setOpen(true)}
              data-testid="admin-create-user"
            >
              {t('admin.users.create')}
            </Button>
          </div>
        }
      />
      <DataTable
        rows={filtered}
        columns={columns}
        rowKey={(u) => u.id}
        loading={loading}
        selectedKey={selectedId}
        onRowClick={(u) => onSelect(u.id)}
        maxHeight="calc(100vh - 300px)"
        emptyState={
          <EmptyState
            icon={<Users />}
            title={t('admin.empty')}
            description={t('admin.users.emptyDescription')}
          />
        }
      />

      <Modal
        open={open}
        onClose={() => {
          if (create.isPending) return;
          setOpen(false);
          resetForm();
        }}
        title={t('admin.users.createTitle')}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
                resetForm();
              }}
              disabled={create.isPending}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={submitCreate} disabled={create.isPending} loading={create.isPending}>
              {t('admin.users.createSubmit')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {(formError || create.isError) && (
            <Alert variant="danger">{formError ?? create.error?.message}</Alert>
          )}
          <Input
            label={t('auth.email')}
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          <Input
            label={t('auth.username')}
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            hint={t('auth.usernameHelp')}
          />
          <Input
            label={t('auth.displayName')}
            autoComplete="off"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <PasswordTextField
            label={t('auth.password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={t('auth.passwordPolicy')}
          />
        </div>
      </Modal>
    </div>
  );
}
