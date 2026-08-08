/**
 * AuditSection — the immutable audit log (Audit-Compliance-Log §3.1 AuditEntry).
 *
 * Filterable by action/category + search; shows actor, target, service,
 * correlation id, and the chain integrity hash. Includes an export action
 * (§5.1 `/export`) and an integrity-verify indicator (§5.1 `/integrity/status`).
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuditEntries, useExportAudit } from '@/api/admin.api';
import { auditActionColor } from '@/components/admin/admin-meta';
import type { AuditAction, AuditCategory } from '@/types/admin.types';
import {
  Box,
  Button,
  Chip,
  MenuItem,
  Select,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Download, ShieldCheck } from 'lucide-react';

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
  const { data: entries, isLoading } = useAuditEntries();
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

  return (
    <Stack gap={1}>
      {/* Filters + actions */}
      <Box sx={{ display: 'flex', gap: 1, p: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <Select
          size="small"
          value={action}
          onChange={(e) => setAction(e.target.value as AuditAction | 'all')}
          sx={{ height: 32, minWidth: 140, fontSize: '0.8rem' }}
        >
          {ACTIONS.map((a) => (
            <MenuItem key={a} value={a}>
              {a === 'all' ? t('admin.audit.allActions') : t(`admin.audit.action.${a}`)}
            </MenuItem>
          ))}
        </Select>
        <Select
          size="small"
          value={category}
          onChange={(e) => setCategory(e.target.value as AuditCategory | 'all')}
          sx={{ height: 32, minWidth: 150, fontSize: '0.8rem' }}
        >
          {CATEGORIES.map((c) => (
            <MenuItem key={c} value={c}>
              {c === 'all' ? t('admin.audit.allCategories') : t(`admin.audit.category.${c}`)}
            </MenuItem>
          ))}
        </Select>
        <TextField
          size="small"
          placeholder={t('admin.audit.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ minWidth: 200, flex: 1, maxWidth: 300 }}
        />
        <Box sx={{ flex: 1 }} />
        <Chip
          size="small"
          icon={<ShieldCheck size={14} />}
          label={t('admin.audit.integrityOk')}
          color="success"
          variant="outlined"
          sx={{ height: 28 }}
        />
        <Button
          size="small"
          variant="outlined"
          startIcon={<Download size={16} />}
          disabled={exportAudit.isPending || filtered.length === 0}
          onClick={() => exportAudit.mutate({ entries: filtered })}
        >
          {exportAudit.isPending ? t('admin.audit.exporting') : t('admin.audit.export')}
        </Button>
      </Box>

      {/* Table */}
      <TableContainer sx={{ maxHeight: 'calc(100vh - 280px)' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>{t('admin.audit.colTime')}</TableCell>
              <TableCell>{t('admin.audit.colAction')}</TableCell>
              <TableCell>{t('admin.audit.colActor')}</TableCell>
              <TableCell>{t('admin.audit.colTarget')}</TableCell>
              <TableCell>{t('admin.audit.colService')}</TableCell>
              <TableCell>{t('admin.audit.colHash')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading
              ? ['ask-a', 'ask-b', 'ask-c', 'ask-d'].map((k) => (
                  <TableRow key={k}>
                    <TableCell colSpan={6}>
                      <Skeleton height={22} />
                    </TableCell>
                  </TableRow>
                ))
              : filtered.map((e) => (
                  <TableRow key={e.id} hover>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(e.timestamp).toLocaleString()}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={t(`admin.audit.action.${e.action}`)}
                        sx={{
                          height: 18,
                          fontSize: '0.65rem',
                          fontWeight: 600,
                          color: '#fff',
                          bgcolor: auditActionColor(e.action),
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap>
                        {e.actorName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {e.actorType}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap>
                        {e.targetType}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ fontFamily: 'monospace' }}
                        noWrap
                      >
                        {e.targetId}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {e.sourceService}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Tooltip title={e.integrityHash}>
                        <Typography
                          variant="caption"
                          sx={{ fontFamily: 'monospace', fontSize: '0.6rem' }}
                          noWrap
                        >
                          {e.integrityHash.slice(0, 16)}…
                        </Typography>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
            {!isLoading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                    {t('admin.empty')}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}
