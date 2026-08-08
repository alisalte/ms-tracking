import { Box, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import { Activity, Camera, MapPin, ShieldCheck, Truck } from 'lucide-react';
import { Outlet } from 'react-router';

/**
 * AuthLayout — premium branded split-panel shell for unauthenticated pages.
 *
 * v2: deep-navy gradient branding panel with floating feature icons + a glass
 * form panel. On mobile it collapses to a centered card.
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
      {/* ── Premium branding panel ── */}
      <Box
        sx={{
          flex: 1.1,
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'center',
          p: 8,
          position: 'relative',
          overflow: 'hidden',
          background: 'linear-gradient(160deg, #0B1120 0%, #131C31 40%, #1E3A5F 100%)',
        }}
      >
        {/* Decorative radial glow */}
        <Box
          sx={{
            position: 'absolute',
            top: '-10%',
            right: '-5%',
            width: 400,
            height: 400,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(59,130,246,0.2) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            bottom: '-10%',
            left: '-5%',
            width: 350,
            height: 350,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 70%)',
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
                borderRadius: 3,
                background: 'linear-gradient(135deg, #3B82F6 0%, #6366F1 100%)',
                boxShadow: '0 8px 24px rgba(59,130,246,0.4)',
              }}
            >
              <ShieldCheck size={24} color="#fff" />
            </Box>
            <Typography variant="h4" fontWeight={800} sx={{ color: '#F1F5F9' }}>
              FleetVision
            </Typography>
          </Stack>

          {/* Headline */}
          <Box>
            <Typography
              variant="h3"
              fontWeight={800}
              sx={{
                color: '#F1F5F9',
                lineHeight: 1.2,
                fontSize: '2rem',
                mb: 1.5,
              }}
            >
              Enterprise Fleet Intelligence
            </Typography>
            <Typography
              sx={{
                color: '#94A3B8',
                fontSize: '1rem',
                lineHeight: 1.7,
                maxWidth: 380,
              }}
            >
              Real-time tracking, video telematics, maintenance, and compliance — unified in one
              calm, fast, secure dashboard.
            </Typography>
          </Box>

          {/* Feature pills */}
          <Stack direction="row" gap={2} sx={{ flexWrap: 'wrap', mt: 2 }}>
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
                  borderRadius: 10,
                  backgroundColor: 'rgba(59,130,246,0.1)',
                  border: '1px solid rgba(59,130,246,0.2)',
                }}
              >
                <Icon size={15} color="#60A5FA" />
                <Typography variant="caption" sx={{ color: '#CBD5E1', fontWeight: 500 }}>
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
