/**
 * CommandParamDialog — dynamic parameter form for one catalog command.
 *
 * Fields are rendered from the command's `params` defs (number / string /
 * enum), bilingual labels straight from the catalog (label/labelFa selected by
 * the active i18n locale — command terminology stays with the catalog, page
 * chrome stays in the locale files). Client-side checks mirror the catalog
 * rules (required / min / max / integer / maxLength); the backend re-validates
 * authoritatively (validateParams) and its message is surfaced on 422.
 */
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import Alert from '@mui/material/Alert';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { FormAlert } from '@/components/form/FormAlert';
import type { CommandDef, CommandParamDef } from '@/types/command.types';

interface CommandParamDialogProps {
  /** The command being configured (null = closed). */
  command: CommandDef | null;
  /** Submit — receives the typed param map. */
  onSubmit: (params: Record<string, string | number>) => Promise<void>;
  onClose: () => void;
}

type Values = Record<string, string>;

export function CommandParamDialog({ command, onSubmit, onClose }: CommandParamDialogProps) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const fa = i18n.language?.startsWith('fa');
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset per command; prefill defaults.
  useEffect(() => {
    if (!command) return;
    const initial: Values = {};
    for (const p of command.params) {
      initial[p.key] = p.defaultValue !== undefined ? String(p.defaultValue) : '';
    }
    setValues(initial);
    setErrors({});
    setServerError(null);
  }, [command]);

  const label = (p: CommandParamDef) => (fa ? p.labelFa : p.label) + (p.required ? ' *' : '');
  const hint = (p: CommandParamDef) => (fa ? p.hintFa : p.hint) ?? undefined;

  const set = (key: string, v: string) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setErrors((prev) => ({ ...prev, [key]: '' }));
  };

  const validate = (): Record<string, string | number> | null => {
    if (!command) return null;
    const out: Record<string, string | number> = {};
    const errs: Record<string, string> = {};
    for (const p of command.params) {
      const raw = (values[p.key] ?? '').trim();
      if (raw === '') {
        if (p.required) errs[p.key] = t('commands.form.required', { defaultValue: 'Required' });
        continue;
      }
      if (p.type === 'number') {
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          errs[p.key] = t('commands.form.number', { defaultValue: 'Must be a number' });
          continue;
        }
        if (p.integer !== false && !Number.isInteger(n)) {
          errs[p.key] = t('commands.form.integer', { defaultValue: 'Must be an integer' });
          continue;
        }
        if (p.min !== undefined && n < p.min) {
          errs[p.key] = t('commands.form.min', { defaultValue: 'Min: {{min}}', min: p.min });
          continue;
        }
        if (p.max !== undefined && n > p.max) {
          errs[p.key] = t('commands.form.max', { defaultValue: 'Max: {{max}}', max: p.max });
          continue;
        }
        out[p.key] = n;
      } else {
        if (p.maxLength !== undefined && raw.length > p.maxLength) {
          errs[p.key] = t('commands.form.maxLength', {
            defaultValue: 'Max {{n}} characters',
            n: p.maxLength,
          });
          continue;
        }
        out[p.key] = raw;
      }
    }
    setErrors(errs);
    return Object.keys(errs).length > 0 ? null : out;
  };

  const handleSubmit = async () => {
    if (!command) return;
    const params = validate();
    if (!params) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await onSubmit(params);
      toast.success(
        t('commands.sent', {
          defaultValue: 'Command {{code}} queued',
          code: command.code,
        }),
      );
      onClose();
    } catch (err) {
      setServerError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const hasParams = useMemo(() => (command?.params.length ?? 0) > 0, [command]);

  return (
    <Dialog open={Boolean(command)} onClose={onClose} maxWidth="sm" fullWidth>
      {command && (
        <>
          <DialogTitle>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography
                component="span"
                sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'primary.main' }}
              >
                {command.code}
              </Typography>
              <Typography component="span" variant="h6">
                {fa ? command.nameFa : command.name}
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {fa ? command.descriptionFa : command.description}
            </Typography>
          </DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {serverError && <FormAlert severity="error" message={serverError} />}
              {!hasParams && (
                <Alert severity="info">
                  {t('commands.form.noParams', {
                    defaultValue: 'This command takes no parameters — confirm to send.',
                  })}
                </Alert>
              )}
              {command.params.map((p) => (
                <TextField
                  key={p.key}
                  size="small"
                  label={`${label(p)}${p.unit ? ` (${p.unit})` : ''}`}
                  value={values[p.key] ?? ''}
                  onChange={(e) => set(p.key, e.target.value)}
                  error={Boolean(errors[p.key])}
                  helperText={errors[p.key] || hint(p) || ' '}
                  select={p.type === 'enum' && (p.options?.length ?? 0) > 0}
                  multiline={p.type === 'string' && (p.maxLength ?? 0) > 60}
                  minRows={p.type === 'string' && (p.maxLength ?? 0) > 60 ? 2 : undefined}
                  slotProps={{
                    htmlInput:
                      p.type === 'number'
                        ? { inputMode: 'decimal' }
                        : p.maxLength !== undefined
                          ? { maxLength: p.maxLength }
                          : undefined,
                  }}
                >
                  {p.type === 'enum' &&
                    (p.options ?? []).map((o) => (
                      <MenuItem key={o.value} value={o.value}>
                        {fa ? o.labelFa : o.label}{' '}
                        <Typography component="span" variant="caption" color="text.secondary">
                          ({o.value})
                        </Typography>
                      </MenuItem>
                    ))}
                </TextField>
              ))}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose} disabled={submitting}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              variant="contained"
              onClick={() => void handleSubmit()}
              disabled={submitting}
              startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {t('commands.form.send', { defaultValue: 'Send command' })}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
