/**
 * ReportRangePicker — the shared time-range control for every report
 * (Sprint J §16): Today | Yesterday | Last 7 Days | Last 30 Days | Custom
 * (datetime-local from/to, converted to UTC ISO before sending — the
 * documented UTC strategy). Accessible: labeled inputs + aria-pressed chips.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReportRange } from '@/api/report.api';
import { Box, Button, Chip, Stack, TextField } from '@mui/material';

const PRESETS: Array<{ id: 'today' | 'yesterday' | '7d' | '30d' }> = [
  { id: 'today' },
  { id: 'yesterday' },
  { id: '7d' },
  { id: '30d' },
];

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ReportRangePicker({
  range,
  onChange,
}: {
  range: ReportRange;
  onChange: (range: ReportRange) => void;
}) {
  const { t } = useTranslation();
  const isCustom = !range.preset;
  const [fromInput, setFromInput] = useState(range.from ? toLocalInput(range.from) : '');
  const [toInput, setToInput] = useState(range.to ? toLocalInput(range.to) : '');

  useEffect(() => {
    if (range.from) setFromInput(toLocalInput(range.from));
    if (range.to) setToInput(toLocalInput(range.to));
  }, [range.from, range.to]);

  const applyCustom = () => {
    const from = fromInput ? new Date(fromInput) : null;
    const to = toInput ? new Date(toInput) : null;
    if (!from || !to || from >= to) return; // invalid — keep last valid range
    onChange({ from: from.toISOString(), to: to.toISOString() });
  };

  return (
    <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
      {PRESETS.map((p) => (
        <Chip
          key={p.id}
          label={t(`reports.range.${p.id}`)}
          color={range.preset === p.id ? 'primary' : 'default'}
          variant={range.preset === p.id ? 'filled' : 'outlined'}
          onClick={() => onChange({ preset: p.id })}
          aria-pressed={range.preset === p.id}
          size="small"
        />
      ))}
      <Chip
        label={t('reports.range.custom')}
        color={isCustom ? 'primary' : 'default'}
        variant={isCustom ? 'filled' : 'outlined'}
        onClick={() =>
          onChange(
            isCustom
              ? { preset: '7d' }
              : {
                  from: new Date(Date.now() - 7 * 86_400_000).toISOString(),
                  to: new Date().toISOString(),
                },
          )
        }
        aria-pressed={isCustom}
        size="small"
        data-testid="report-range-custom"
      />
      {isCustom && (
        <Stack direction="row" alignItems="center" gap={0.5}>
          <TextField
            type="datetime-local"
            size="small"
            value={fromInput}
            onChange={(e) => setFromInput(e.target.value)}
            aria-label={t('reports.range.from')}
            slotProps={{ htmlInput: { 'aria-label': t('reports.range.from') } }}
            sx={{ width: 205, '& input': { py: 0.5, fontSize: 13 } }}
          />
          <Box component="span" sx={{ color: 'text.secondary' }}>
            →
          </Box>
          <TextField
            type="datetime-local"
            size="small"
            value={toInput}
            onChange={(e) => setToInput(e.target.value)}
            aria-label={t('reports.range.to')}
            slotProps={{ htmlInput: { 'aria-label': t('reports.range.to') } }}
            sx={{ width: 205, '& input': { py: 0.5, fontSize: 13 } }}
          />
          <Button size="small" variant="contained" onClick={applyCustom} data-testid="report-range-apply">
            {t('reports.range.apply')}
          </Button>
        </Stack>
      )}
    </Stack>
  );
}
