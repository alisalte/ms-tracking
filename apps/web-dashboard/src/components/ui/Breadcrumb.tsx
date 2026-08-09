import { Box, Link as MuiLink } from '@mui/material';
import { ChevronRight, Home } from 'lucide-react';
import { Fragment } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

export interface BreadcrumbItem {
  /** i18n key OR raw label. */
  label: string;
  /** Optional route target; omit for the current (last) crumb. */
  to?: string;
  /** True to translate the label via t(); default true. */
  translate?: boolean;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

/**
 * Breadcrumb — Limitless-style breadcrumb (home + trail, chevron separator).
 *
 * RTL-aware: the chevron flips via logical properties (rotateY) so the visual
 * flow is correct in Persian. The last item is rendered as plain text.
 */
export function Breadcrumb({ items }: BreadcrumbProps) {
  const { t } = useTranslation();
  return (
    <Box
      component="nav"
      aria-label="breadcrumb"
      className="fv-breadcrumb"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        flexWrap: 'wrap',
        '& svg': { flexShrink: 0 },
      }}
    >
      <MuiLink
        component={Link}
        to="/dashboard"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          color: 'text.secondary',
          '&:hover': { color: 'primary.main' },
        }}
      >
        <Home size={14} />
      </MuiLink>
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        const text = item.translate === false ? item.label : t(item.label);
        return (
          <Fragment key={`${item.label}-${idx}`}>
            <ChevronRight size={14} className="fv-breadcrumb-sep" />
            {isLast || !item.to ? (
              <Box
                component="span"
                sx={{
                  color: 'text.primary',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                }}
              >
                {text}
              </Box>
            ) : (
              <MuiLink
                component={Link}
                to={item.to}
                sx={{
                  color: 'text.secondary',
                  fontSize: '0.75rem',
                  '&:hover': { color: 'primary.main' },
                }}
              >
                {text}
              </MuiLink>
            )}
          </Fragment>
        );
      })}
    </Box>
  );
}
