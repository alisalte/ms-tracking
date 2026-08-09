import { Box, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import { Activity, Camera, MapPin, ShieldCheck, Truck } from 'lucide-react';
import { Outlet } from 'react-router';

/**
 * AuthLayout — branded split-panel shell for unauthenticated pages.
 *
 * v3 (Limitless-inspired): keeps the FleetVision branded side panel (navy
 * gradient + feature pills) but the form panel now reads as Limitless — clean
 * light surface, 3px cards. On mobile it collapses to a centered card. RTL-safe.
 */
export function AuthLayout() {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));

  if (!isDesktop) {
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

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* ── Branded panel ── */}
      <Box
        sx={{
          flex: 1.1,
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'center',
          p: 8,
          position: 'relative',
          overflow: 'hidden',
          background: 'linear-gradient(160deg, #1A2733 0%, #263238 45%, #37474F 100%)',
        }}
      >
        {/* Decorative radial glow */}
        <Box
          sx={{
            position: 'absolute',
            top: '-12%',
            insetInlineEnd: '-8%',
            width: 420,
            height: 420,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(33,150,243,0.22) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            bottom: '-12%',
            insetInlineStart: '-8%',
            width: 360,
            height: 360,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(63,81,181,0.18) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />

        <Stack spacing={4} sx={{ maxWidth: 440, position: 'relative', zIndex: 1 }}>
          {/* Logo */}
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 44,
                height: 44,
                borderRadius: 1,
                background: 'linear-gradient(135deg, #2196F3 0%, #3F51B5 100%)',
                boxShadow: '0 8px 24px rgba(33,150,243,0.4)',
              }}
            >
              <ShieldCheck size={24} color="#fff" />
            </Box>
            <Typography variant="h4" fontWeight={700} sx={{ color: '#FFFFFF' }}>
              FleetVision
            </Typography>
          </Stack>

          {/* Headline */}
          <Box>
            <Typography
              sx={{
                color: '#FFFFFF',
                lineHeight: 1.2,
                fontSize: '1.75rem',
                fontWeight: 700,
                mb: 1.5,
              }}
            >
              Enterprise Fleet Intelligence
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.95rem', lineHeight: 1.7 }}>
              Real-time tracking, video telematics, maintenance, and compliance — unified in one calm,
              fast, secure dashboard.
            </Typography>
          </Box>

          {/* Feature pills */}
          <Stack direction="row" gap={1.5} sx={{ flexWrap: 'wrap', mt: 2 }}>
            {[
              { icon: Truck, label: 'Fleet Tracking' },
              { icon: MapPin, label: 'Live Map' },
              { icon: Camera, label: 'Video Wall' },
              { icon: Activity, label: 'Real-time Alerts' },
            ].map(({ icon: Icon, label }) => (
              <Stack
                key={label}
                direction="row"
                alignItems="center"
                gap={0.75}
                sx={{
                  px: 1.5,
                  py: 1,
                  borderRadius: 99,
                  backgroundColor: 'rgba(33,150,243,0.14)',
                  border: '1px solid rgba(33,150,243,0.28)',
                }}
              >
                <Icon size={15} color="#64B5F6" />
                <Typography variant="caption" sx={{ color: '#ECEFF1', fontWeight: 500 }}>
                  {label}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Stack>
      </Box>

      {/* ── Form panel ── */}
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
        <Box sx={{ animation: 'fv-fade-in 0.4s ease', width: '100%', maxWidth: 420 }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
