/**
 * CommandCatalogPanel — category-tabbed browser over the Meitrack MDVR command
 * catalog. Commands without parameters dispatch directly (confirm dialog for
 * safety-sensitive ones); parameterized commands open CommandParamDialog.
 */
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CommandCategory, CommandDef } from '@/types/command.types';

interface CommandCatalogPanelProps {
  catalog: CommandDef[];
  loading?: boolean;
  disabled?: boolean;
  /** Parameterized-command callback (opens the form dialog). */
  onConfigure: (command: CommandDef) => void;
  /** No-parameter-command callback (direct dispatch). */
  onDispatch: (command: CommandDef) => void;
}

export function CommandCatalogPanel({
  catalog,
  loading,
  disabled,
  onConfigure,
  onDispatch,
}: CommandCatalogPanelProps) {
  const { t, i18n } = useTranslation();
  const fa = i18n.language?.startsWith('fa');
  const [category, setCategory] = useState<CommandCategory | 'all'>('all');
  const [search, setSearch] = useState('');

  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const c of catalog) seen.add(c.category);
    return [...seen].sort() as CommandCategory[];
  }, [catalog]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog.filter((c) => {
      if (category !== 'all' && c.category !== category) return false;
      if (!q) return true;
      return (
        c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || c.nameFa.includes(q)
      );
    });
  }, [catalog, category, search]);

  if (loading) {
    return (
      <Typography color="text.secondary" sx={{ p: 2 }}>
        {t('common.loading', { defaultValue: 'Loading…' })}
      </Typography>
    );
  }

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        <Box sx={{ borderBottom: 1, borderColor: 'divider', flex: 1, minWidth: 0 }}>
          <Tabs
            value={category}
            onChange={(_, v: CommandCategory | 'all') => setCategory(v)}
            variant="scrollable"
            scrollButtons="auto"
          >
            <Tab
              value="all"
              label={t('commands.categories.all', { defaultValue: 'All' })}
              sx={{ minHeight: 40 }}
            />
            {categories.map((c) => (
              <Tab
                key={c}
                value={c}
                label={t(`commands.categories.${c}`, { defaultValue: c })}
                sx={{ minHeight: 40 }}
              />
            ))}
          </Tabs>
        </Box>
        <Button size="small" onClick={() => setSearch('')} disabled={!search}>
          {t('common.clear', { defaultValue: 'Clear' })}
        </Button>
      </Stack>

      <TextFieldMini value={search} onChange={setSearch} />

      {disabled && (
        <Alert severity="info">
          {t('commands.selectDeviceFirst', {
            defaultValue: 'Select a device to enable commands.',
          })}
        </Alert>
      )}

      {filtered.length === 0 && (
        <Typography color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
          {t('commands.noMatch', { defaultValue: 'No commands match.' })}
        </Typography>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fill, minmax(280px, 1fr))' },
          gap: 1.5,
        }}
      >
        {filtered.map((cmd) => (
          <Card key={cmd.code} variant="outlined" sx={{ display: 'flex' }}>
            <CardActionArea
              disabled={disabled}
              onClick={() => (cmd.params.length > 0 ? onConfigure(cmd) : onDispatch(cmd))}
              sx={{ p: 1.5, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
            >
              <Stack spacing={0.5} sx={{ width: '100%' }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography
                    component="code"
                    sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'primary.main' }}
                  >
                    {cmd.code}
                  </Typography>
                  <Chip
                    size="small"
                    label={t(`commands.categories.${cmd.category}`, {
                      defaultValue: cmd.category,
                    })}
                    sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: 11 } }}
                  />
                  {cmd.supportsReadback && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={t('commands.readable', { defaultValue: 'readable' })}
                      sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: 11 } }}
                    />
                  )}
                </Stack>
                <Typography variant="subtitle2">{fa ? cmd.nameFa : cmd.name}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ minHeight: 30 }}>
                  {fa ? cmd.descriptionFa : cmd.description}
                </Typography>
              </Stack>
            </CardActionArea>
          </Card>
        ))}
      </Box>
    </Stack>
  );
}

/** Small inline search box (kept local to avoid prop-drilling the Toolbar). */
function TextFieldMini({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <TextField
      size="small"
      fullWidth
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t('commands.search', { defaultValue: 'Search commands…' })}
    />
  );
}
