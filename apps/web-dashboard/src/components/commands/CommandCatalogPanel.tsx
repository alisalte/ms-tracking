/**
 * CommandCatalogPanel — category-tabbed browser over the Meitrack MDVR command
 * catalog. Commands without parameters dispatch directly (confirm dialog for
 * safety-sensitive ones); parameterized commands open CommandParamDialog.
 */
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, Badge, Button, Card, Input, Spinner, Tabs } from '@/components/tailwind-ui';
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
      <div className="flex items-center gap-2 p-4 text-sm text-gray-500 dark:text-graydark-600">
        <Spinner size="sm" />
        {t('common.loading', { defaultValue: 'Loading…' })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          className="min-w-0 flex-1"
          aria-label={t('commands.title', { defaultValue: 'Command Center' })}
          value={category}
          onChange={(v) => setCategory(v)}
          tabs={[
            { value: 'all' as const, label: t('commands.categories.all', { defaultValue: 'All' }) },
            ...categories.map((c) => ({
              value: c,
              label: t(`commands.categories.${c}`, { defaultValue: c }),
            })),
          ]}
        />
        <Button size="sm" variant="ghost" onClick={() => setSearch('')} disabled={!search}>
          {t('common.clear', { defaultValue: 'Clear' })}
        </Button>
      </div>

      <TextFieldMini value={search} onChange={setSearch} />

      {disabled && (
        <Alert variant="info">
          {t('commands.selectDeviceFirst', {
            defaultValue: 'Select one or more devices to enable commands.',
          })}
        </Alert>
      )}

      {filtered.length === 0 && (
        <p className="p-4 text-center text-sm text-gray-500 dark:text-graydark-600">
          {t('commands.noMatch', { defaultValue: 'No commands match.' })}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
        {filtered.map((cmd) => (
          <Card
            key={cmd.code}
            as="button"
            type="button"
            flush
            interactive
            disabled={disabled}
            onClick={() => (cmd.params.length > 0 ? onConfigure(cmd) : onDispatch(cmd))}
            className="w-full p-3 text-start disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            <div className="flex w-full flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-bold text-brand-600 dark:text-brand-400">
                  {cmd.code}
                </span>
                <Badge>
                  {t(`commands.categories.${cmd.category}`, { defaultValue: cmd.category })}
                </Badge>
                {cmd.supportsReadback && (
                  <Badge color="teal">{t('commands.readable', { defaultValue: 'readable' })}</Badge>
                )}
              </div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {fa ? cmd.nameFa : cmd.name}
              </p>
              <p className="min-h-[30px] text-xs text-gray-500 dark:text-graydark-600">
                {fa ? cmd.descriptionFa : cmd.description}
              </p>
            </div>
          </Card>
        ))}
      </div>
    </div>
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
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t('commands.search', { defaultValue: 'Search commands…' })}
      aria-label={t('commands.search', { defaultValue: 'Search commands…' })}
      leftIcon={<Search size={14} />}
    />
  );
}
