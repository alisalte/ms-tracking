import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Input, type InputProps } from '@/components/tailwind-ui';

/**
 * Password input with a show/hide (eye) toggle (TailAdmin).
 *
 * Stateless and controlled by the parent — pass `value`, `onChange`, `error`,
 * and `hint` exactly as you would the tailwind `Input`. This keeps it usable
 * both inside a `react-hook-form` `<Controller>` and with plain state.
 *
 * The toggle has a translated, screen-reader label (UI_UX_Design.md §0.8).
 * `autoComplete` defaults to `new-password`; override for current-password
 * (login).
 */
export interface PasswordTextFieldProps extends Omit<InputProps, 'type'> {
  /** Override the default `new-password` autocomplete. Use `current-password` for login. */
  autoCompleteValue?: string;
}

export function PasswordTextField({
  autoCompleteValue = 'new-password',
  className = '',
  ...props
}: PasswordTextFieldProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  return (
    <Input
      {...props}
      type={visible ? 'text' : 'password'}
      autoComplete={autoCompleteValue}
      className={className}
      // The toggle is an Input endAdornment: it sits inside the input's own
      // relative row (end-2 + top-1/2 -translate-y-1/2), so it stays aligned
      // with the field regardless of label/hint height.
      endAdornment={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          onMouseDown={(e) => e.preventDefault()} // prevent focus loss
          aria-label={visible ? t('common.hidePassword') : t('common.showPassword')}
          className="inline-flex size-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:text-graydark-700"
        >
          {visible ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        </button>
      }
    />
  );
}
