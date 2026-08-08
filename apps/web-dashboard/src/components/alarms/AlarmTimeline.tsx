/**
 * AlarmTimeline — the chronological view of the Alarm Center.
 *
 * Buckets alarms by hour over the last 24h and lays them out as severity-
 * colored event blocks. Each block is clickable → opens the detail drawer.
 * This is the operator's "what happened and when" triage view, complementing
 * the list (per-alarm) and the map (spatial).
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { severityColor } from '@/components/alarms/AlarmTypeIcon';
import type { Alarm } from '@/types/alarm.types';
import { Box, Chip, Skeleton, Stack, Tooltip, Typography } from '@mui/material';

interface AlarmTimelineProps {
  alarms: Alarm[];
  loading?: boolean;
  selectedId?: string | null;
  onSelect: (id: string) => void;
}

/** Bucket alarms into the 24 hours of the day they were raised. */
function bucketByHour(alarms: Alarm[]): Map<number, Alarm[]> {
  const map = new Map<number, Alarm[]>();
  for (let h = 0; h < 24; h++) map.set(h, []);
  for (const a of alarms) {
    const h = new Date(a.raisedAt).getHours();
    map.get(h)?.push(a);
  }
  return map;
}

export function AlarmTimeline({
  alarms,
  loading = false,
  selectedId,
  onSelect,
}: AlarmTimelineProps) {
  const { t } = useTranslation();
  const buckets = useMemo(() => bucketByHour(alarms), [alarms]);

  if (loading) {
    const skelKeys = ['tsk-a', 'tsk-b', 'tsk-c', 'tsk-d', 'tsk-e', 'tsk-f', 'tsk-g', 'tsk-h'];
    return (
      <Stack gap={1} sx={{ p: 2 }}>
        {skelKeys.map((k) => (
          <Skeleton key={k} height={36} />
        ))}
      </Stack>
    );
  }

  if (alarms.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <Typography color="text.secondary">{t('alarms.empty')}</Typography>
      </Box>
    );
  }

  // Render newest hour first (23 → 0).
  const hours = Array.from({ length: 24 }, (_, i) => 23 - i);

  return (
    <Box sx={{ p: 2, overflowY: 'auto', maxHeight: 'calc(100vh - 220px)' }}>
      <Stack gap={1}>
        {hours.map((h) => {
          const bucket = buckets.get(h) ?? [];
          if (bucket.length === 0) return null;
          return (
            <Box
              key={h}
              sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, minHeight: 32 }}
            >
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ width: 44, flexShrink: 0, pt: 0.5, fontFamily: 'monospace' }}
              >
                {String(h).padStart(2, '0')}:00
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, flex: 1 }}>
                {bucket.map((a) => (
                  <Tooltip key={a.id} title={`${a.vehicleLabel} · ${a.message}`}>
                    <Chip
                      size="small"
                      label={a.message}
                      onClick={() => onSelect(a.id)}
                      variant={a.id === selectedId ? 'filled' : 'outlined'}
                      sx={{
                        height: 24,
                        fontSize: '0.7rem',
                        bgcolor: a.id === selectedId ? severityColor(a.severity) : 'transparent',
                        color: a.id === selectedId ? '#fff' : severityColor(a.severity),
                        borderColor: severityColor(a.severity),
                        maxWidth: 200,
                        cursor: 'pointer',
                        '& .MuiChip-label': { px: 1, overflow: 'hidden', textOverflow: 'ellipsis' },
                      }}
                    />
                  </Tooltip>
                ))}
              </Box>
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}
