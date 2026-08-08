import { Box, Chip, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import { ShieldCheck } from 'lucide-react';
import { Outlet } from 'react-router';

/**
 * AuthLayout — branded split-panel shell for unauthenticated pages (login,
 * register, forgot/reset password, MFA verify).
 *
 * On `md`+ viewports it renders a two-column split: a branded marketing panel
 * (left/right per direction — MUI flex honors RTL automatically) and the form
 * card on the other side. On smaller screens it collapses to a centered card so
 * the form stays usable on mobile.
 *
 * Follows the FleetVision login wireframe aesthetic (`Authentication.md` §9.2).
 */
export function AuthLayout() {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));

  if (!isDesktop) {
    // Mobile: centered single column.
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: 'background.default',
          p: 2,
        }}
      >
        <Outlet />
      </Box>
    );
  }

  // Desktop: branded split panel.
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* Branding panel */}
      <Box
        sx={{
          flex: 1,
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'center',
          p: 8,
          background: (t) =>
            `linear-gradient(135deg, ${t.palette.primary.main} 0%, ${t.palette.primary.dark} 100%)`,
          color: 'primary.contrastText',
        }}
      >
        <Stack spacing={3} sx={{ maxWidth: 420 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <ShieldCheck size={32} />
            <Typography variant="h4" fontWeight={700}>
              FleetVision
            </Typography>
          </Stack>
          <Typography variant="h5" fontWeight={600} sx={{ opacity: 0.95 }}>
            Enterprise Fleet Management Platform
          </Typography>
          <Typography variant="body1" sx={{ opacity: 0.85, lineHeight: 1.6 }}>
            Real-time tracking, video telematics, maintenance, and compliance —
            unified in one calm, fast, accessible dashboard.
          </Typography>
          <Box>
            <Chip
              label="TLS · Protected by FleetVision Security"
              size="small"
              sx={{
                color: 'primary.contrastText',
                backgroundColor: 'rgba(255,255,255,0.15)',
                border: '1px solid rgba(255,255,255,0.25)',
              }}
            />
          </Box>
        </Stack>
      </Box>

      {/* Form panel */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 4,
          backgroundColor: 'background.default',
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
}
