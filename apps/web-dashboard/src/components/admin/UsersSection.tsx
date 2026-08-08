/**
 * UsersSection — the Users & Roles table (UI_UX §5.3 wireframe).
 *
 * Columns: name, email, role, MFA, last-login. Filter by role/status + search.
 * Row click opens the user detail drawer (selection → detail, UI_UX §0.6).
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { userStatusColor } from '@/components/admin/admin-meta';
import type { AdminUserStatus } from '@/types/admin.types';
import type { AdminUser } from '@/types/admin.types';
import {
  Box,
  Chip,
  MenuItem,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';

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

  if (loading) {
    const keys = ['usk-a', 'usk-b', 'usk-c', 'usk-d', 'usk-e', 'usk-f'];
    return (
      <TableContainer>
        <Table size="small">
          <TableBody>
            {keys.map((k) => (
              <TableRow key={k}>
                <TableCell colSpan={5}>
                  <Skeleton height={26} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 1, p: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <Select
          size="small"
          value={filterStatus}
          onChange={(e) => onFilterStatus(e.target.value as AdminUserStatus | 'all')}
          sx={{ height: 32, minWidth: 140, fontSize: '0.8rem' }}
        >
          {STATUSES.map((s) => (
            <MenuItem key={s} value={s}>
              {s === 'all' ? t('admin.users.allStatus') : t(`admin.users.status.${s}`)}
            </MenuItem>
          ))}
        </Select>
        <TextField
          size="small"
          placeholder={t('admin.users.search')}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          sx={{ minWidth: 240, flex: 1, maxWidth: 360 }}
        />
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">
          {t('admin.count', { count: filtered.length })}
        </Typography>
      </Box>
      <TableContainer sx={{ maxHeight: 'calc(100vh - 280px)' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>{t('admin.users.colName')}</TableCell>
              <TableCell>{t('admin.users.colRole')}</TableCell>
              <TableCell>{t('admin.users.colMfa')}</TableCell>
              <TableCell>{t('admin.users.colStatus')}</TableCell>
              <TableCell align="right">{t('admin.users.colLastLogin')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((u) => (
              <TableRow
                key={u.id}
                hover
                selected={u.id === selectedId}
                onClick={() => onSelect(u.id)}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {u.firstName} {u.lastName}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {u.email}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{u.roleName}</Typography>
                </TableCell>
                <TableCell>
                  {u.mfaEnabled ? (
                    <Chip
                      size="small"
                      label="✓"
                      color="success"
                      sx={{ height: 18, minWidth: 28 }}
                    />
                  ) : (
                    <Typography variant="caption" color="text.disabled">
                      —
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={t(`admin.users.status.${u.status}`)}
                    sx={{
                      height: 20,
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      color: '#fff',
                      bgcolor: userStatusColor(u.status),
                    }}
                  />
                </TableCell>
                <TableCell align="right">
                  <Typography variant="caption" color="text.secondary">
                    {u.lastLoginAt ? rel(u.lastLoginAt) : '—'}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                    {t('admin.empty')}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

/** Compact relative time. */
function rel(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}
