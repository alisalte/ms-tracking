import { Eye, EyeOff } from 'lucide-react';
import { IconButton, InputAdornment, TextField, type TextFieldProps } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Password input with a show/hide (eye) toggle.
 *
 * Stateless and controlled by the parent — pass `value`, `onChange`, `error`,
 * and `helperText` exactly as you would a MUI `TextField`. This keeps it usable
 * both inside a `react-hook-form` `<Controller>` and with plain state.
 *
 * The toggle meets the 44×44px touch target and has a translated, screen-reader
 * label (UI_UX_Design.md §0.8). `autoComplete` defaults to `new-password`;
 * override for current-password (login).
 */
export interface PasswordTextFieldProps
  extends Omit<TextFieldProps, 'type' | 'InputProps'> {
  /** Override the default `new-password` autocomplete. Use `current-password` for login. */
  autoCompleteValue?: string;
}

export function PasswordTextField({
  autoCompleteValue = 'new-password',
  ...props
}: PasswordTextFieldProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      autoComplete={autoCompleteValue}
      slotProps={{
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                aria-label={visible ? t('common.hidePassword') : t('common.showPassword')}
                onClick={() => setVisible((v) => !v)}
                onMouseDown={(e) => e.preventDefault()} // prevent focus loss
                edge="end"
                size="small"
              >
                {visible ? <EyeOff size={20} /> : <Eye size={20} />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
