import { Button, Menu, MenuItem } from '@mui/material';
import { ChevronDown, Globe } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES } from '@/i18n/config';

/**
 * LanguageSwitcher — compact top-bar menu to switch the UI language.
 *
 * Calls `i18n.changeLanguage`, which:
 *  - updates all `t()` consumers,
 *  - re-runs the `ThemeRegistry` direction effect (flips MUI + `<html dir>`),
 *  - is persisted to localStorage by i18next-browser-languagedetector.
 *
 * Source: UI_UX_Design.md §0.9 (i18n + RTL).
 */
export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => setAnchorEl(null);

  const handleSelect = (language: string) => {
    void i18n.changeLanguage(language);
    handleClose();
  };

  const currentLabel = LANGUAGE_LABELS[i18n.language] ?? i18n.language;

  return (
    <>
      <Button
        size="small"
        onClick={handleOpen}
        startIcon={<Globe size={18} />}
        endIcon={<ChevronDown size={16} />}
        sx={{
          color: 'text.primary',
          textTransform: 'none',
          minWidth: 0,
          px: 1,
        }}
        aria-label="select language"
      >
        {currentLabel}
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        slotProps={{ paper: { sx: { mt: 0.5, minWidth: 140 } } }}
      >
        {SUPPORTED_LANGUAGES.map((language) => (
          <MenuItem
            key={language}
            selected={i18n.language === language}
            onClick={() => handleSelect(language)}
          >
            {LANGUAGE_LABELS[language] ?? language}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
