/**
 * ReportDefinitionsSection — the report catalog + on-demand generate.
 *
 * Lists builtin report definitions grouped/filterable by category (Reporting
 * §1.3), each with its supported formats. "Generate" opens a dialog (pick
 * formats + confirm) that submits an async job via `useGenerateReport`
 * (Reporting §5.2). The new job surfaces in the Jobs section.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useGenerateReport, useReportDefinitions } from '@/api/report.api';
import type { ReportCategory, ReportDefinition, ReportFormat } from '@/types/report.types';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { FileBarChart, ShieldCheck } from 'lucide-react';

const CATEGORIES: Array<ReportCategory | 'all'> = [
  'all',
  'operational',
  'safety',
  'compliance',
  'maintenance',
  'fuel',
  'financial',
  'asset',
  'executive',
];
const ALL_FORMATS: ReportFormat[] = ['PDF', 'XLSX', 'CSV', 'HTML'];

interface Props {
  /** Notify the parent that a job was generated (so it can switch to Jobs). */
  onGenerated?: () => void;
}

export function ReportDefinitionsSection({ onGenerated }: Props) {
  const { t } = useTranslation();
  const { data: definitions, isLoading } = useReportDefinitions();
  const generate = useGenerateReport();
  const [category, setCategory] = useState<ReportCategory | 'all'>('all');
  const [genTarget, setGenTarget] = useState<ReportDefinition | null>(null);
  const [genFormats, setGenFormats] = useState<ReportFormat[]>(['PDF']);

  const filtered = (definitions ?? []).filter((d) => category === 'all' || d.category === category);

  const submitGenerate = () => {
    if (!genTarget) return;
    const formats: ReportFormat[] = genFormats.length ? genFormats : ['PDF'];
    generate.mutate({ definitionId: genTarget.id, formats }, { onSuccess: () => onGenerated?.() });
    setGenTarget(null);
  };

  return (
    <Stack gap={2}>
      <ToggleButtonGroup
        value={category}
        exclusive
        size="small"
        onChange={(_, v) => v && setCategory(v as ReportCategory | 'all')}
        sx={{ flexWrap: 'wrap' }}
      >
        {CATEGORIES.map((c) => (
          <ToggleButton key={c} value={c} sx={{ px: 1.5, py: 0.25, fontSize: '0.75rem' }}>
            {c === 'all' ? t('reports.filters.allCategories') : t(`reports.category.${c}`)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
          gap: 1.5,
        }}
      >
        {(isLoading ? [] : filtered).map((d) => (
          <Box
            key={d.id}
            sx={{
              p: 2,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
            }}
          >
            <Stack direction="row" alignItems="center" gap={1}>
              {d.isRegulatory ? (
                <ShieldCheck size={18} color="#DC2626" />
              ) : (
                <FileBarChart size={18} color="#2563EB" />
              )}
              <Typography variant="subtitle2" sx={{ flex: 1, fontWeight: 600 }} noWrap>
                {d.name}
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minHeight: 40 }}>
              {d.description}
            </Typography>
            <Stack direction="row" gap={0.5} sx={{ flexWrap: 'wrap' }}>
              <Chip
                size="small"
                label={t(`reports.category.${d.category}`)}
                sx={{ height: 18, fontSize: '0.6rem' }}
              />
              {d.formats.map((f) => (
                <Chip
                  key={f}
                  size="small"
                  label={f}
                  variant="outlined"
                  sx={{ height: 18, fontSize: '0.6rem' }}
                />
              ))}
            </Stack>
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                setGenTarget(d);
                setGenFormats(d.formats.slice(0, 1));
              }}
            >
              {t('reports.generate')}
            </Button>
          </Box>
        ))}
      </Box>

      {/* Generate dialog */}
      <Dialog open={Boolean(genTarget)} onClose={() => setGenTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('reports.generateTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {genTarget?.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('reports.formats')}
          </Typography>
          <Select
            multiple
            size="small"
            fullWidth
            value={genFormats}
            onChange={(e) => setGenFormats(e.target.value as unknown as ReportFormat[])}
            sx={{ mt: 0.5 }}
            renderValue={(v) => v.join(', ')}
          >
            {(genTarget?.formats ?? ALL_FORMATS).map((f) => (
              <MenuItem key={f} value={f}>
                {f}
              </MenuItem>
            ))}
          </Select>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGenTarget(null)}>{t('reports.cancel')}</Button>
          <Button variant="contained" disabled={generate.isPending} onClick={submitGenerate}>
            {generate.isPending ? t('reports.generating') : t('reports.generate')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
