import { AlarmStatusBadge } from '@/components/alarms/AlarmStatusBadge';
/**
 * AlarmList — the table view of the Alarm Center.
 *
 * Renders a sortable list of alarms with the type icon, vehicle, headline,
 * severity, status badge, and relative time. Row click opens the detail drawer
 * (selection → detail pattern, UI_UX §0.6). Sorting is newest-first by default
 * (matches the mock ordering + §5 "newest-first" triage flow).
 */
import { alarmTypeIcon, severityColor } from '@/components/alarms/AlarmTypeIcon';
import type { Alarm } from '@/types/alarm.types';
import {
  Box,
  Chip,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

interface AlarmListProps {
  /** The (already-filtered) alarms to render. */
  alarms: Alarm[];
  /** Loading state — render skeleton rows. */
  loading?: boolean;
  /** Currently selected alarm id (row highlight). */
  selectedId?: string | null;
  /** Open the detail drawer for an alarm. */
  onSelect: (id: string) => void;
}

/** Locale-aware relative time for the list (e.g. "12m ago"). */
function relative(iso: string, t: (k: string, opts?: Record<string, unknown>) => string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return t('dashboard.relative.justNow');
  if (min < 60) return t('dashboard.relative.minutes', { count: min });
  const hr = Math.round(min / 60);
  if (hr < 24) return t('dashboard.relative.hours', { count: hr });
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function AlarmList({ alarms, loading = false, selectedId, onSelect }: AlarmListProps) {
  const { t } = useTranslation();

  if (loading) {
    // Fixed skeleton rows — stable keys (not array indices).
    const skelKeys = ['sk-a', 'sk-b', 'sk-c', 'sk-d', 'sk-e', 'sk-f', 'sk-g', 'sk-h'];
    return (
      <TableContainer>
        <Table size="small">
          <TableBody>
            {skelKeys.map((k) => (
              <TableRow key={k}>
                <TableCell colSpan={5}>
                  <Skeleton height={28} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  }

  if (alarms.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <Typography color="text.secondary">{t('alarms.empty')}</Typography>
      </Box>
    );
  }

  return (
    <TableContainer sx={{ maxHeight: 'calc(100vh - 220px)' }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>{t('alarms.list.colType')}</TableCell>
            <TableCell>{t('alarms.list.colVehicle')}</TableCell>
            <TableCell>{t('alarms.list.colSeverity')}</TableCell>
            <TableCell>{t('alarms.list.colStatus')}</TableCell>
            <TableCell align="right">{t('alarms.list.colTime')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {alarms.map((a) => {
            const Icon = alarmTypeIcon(a.type);
            const isSel = a.id === selectedId;
            return (
              <TableRow
                key={a.id}
                hover
                selected={isSel}
                onClick={() => onSelect(a.id)}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box
                      sx={{
                        display: 'flex',
                        color: severityColor(a.severity),
                      }}
                    >
                      <Icon size={16} />
                    </Box>
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {a.message}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t(`alarms.type.${a.type}`)}
                      </Typography>
                    </Box>
                  </Box>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" noWrap>
                    {a.vehicleLabel}
                  </Typography>
                  {a.driver && (
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {a.driver}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={t(`alarms.severity.${a.severity}`)}
                    sx={{
                      height: 20,
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      color: '#fff',
                      bgcolor: severityColor(a.severity),
                    }}
                  />
                </TableCell>
                <TableCell>
                  <AlarmStatusBadge status={a.status} label={t(`alarms.status.${a.status}`)} />
                </TableCell>
                <TableCell align="right">
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {relative(a.raisedAt, t)}
                  </Typography>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
