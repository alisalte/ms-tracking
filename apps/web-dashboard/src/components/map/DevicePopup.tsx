import {
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import {
  Gauge,
  History,
  type LucideIcon,
  MapPin,
  Navigation,
  Power,
  Send,
  Tag,
  User,
  Video,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useVehicleDetail } from '@/api/fleet.api';
import { status } from '@/theme/palette';
import type { AlertSeverity } from '@/types/fleet.types';

import { LiveBadge } from '@/components/dashboard/LiveBadge';

const DRAWER_WIDTH = 360;

/** Severity → semantic color for the recent-events list. */
const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  critical: status.red,
  warning: status.amber,
  info: status.slate,
};

interface DevicePopupProps {
  /** Vehicle id to show; `null` closes the drawer. */
  vehicleId: string | null;
  onClose: () => void;
}

/**
 * DevicePopup — right slide-over drawer (UI_UX_Design.md §2.5).
 *
 * The control center for one vehicle: status header + live dot, quick facts
 * (speed/heading/odometer/ignition/driver/address/age), recent events, and
 * quick actions. Never a page navigation. Backed by `useVehicleDetail`.
 */
export function DevicePopup({ vehicleId, onClose }: DevicePopupProps) {
  const { t } = useTranslation();
  const { data, isLoading } = useVehicleDetail(vehicleId);

  return (
    <Drawer
      anchor="right"
      open={Boolean(vehicleId)}
      onClose={onClose}
      variant="temporary"
      ModalProps={{ keepMounted: true }}
      sx={{
        '& .MuiDrawer-paper': { width: { xs: '100%', sm: DRAWER_WIDTH }, maxWidth: '100%' },
      }}
    >
      <Stack sx={{ height: '100%' }}>
        {/* ── Header ── */}
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}
        >
          <Stack direction="row" alignItems="center" gap={1}>
            {isLoading || !data ? (
              <Skeleton variant="text" width={120} />
            ) : (
              <>
                <Typography variant="h6" fontWeight={700}>
                  {data.label}
                </Typography>
                {data.state === 'driving' && <LiveBadge />}
              </>
            )}
          </Stack>
          <IconButton size="small" onClick={onClose} aria-label={t('map.popup.close')}>
            <X size={18} />
          </IconButton>
        </Stack>

        {isLoading || !data ? (
          <Box sx={{ p: 2 }}>
            <Skeleton variant="rounded" height={120} />
            <Skeleton variant="text" sx={{ mt: 2 }} />
            <Skeleton variant="text" />
          </Box>
        ) : (
          <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
            {/* Status pill */}
            <Chip
              size="small"
              label={t(`map.states.${data.state}`)}
              sx={{
                mb: 2,
                fontWeight: 600,
                backgroundColor: `${SEVERITY_COLOR.warning}1A`,
                color: data.state === 'overspeed' ? status.red : 'text.primary',
              }}
            />

            {/* ── Quick facts grid ── */}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 1.5,
                mb: 2,
              }}
            >
              <Fact icon={Gauge} label={t('map.popup.speed')} value={`${data.speed} km/h`} />
              <Fact icon={Navigation} label={t('map.popup.heading')} value={`${data.heading}°`} />
              <Fact
                icon={Power}
                label={t('map.popup.ignition')}
                value={data.ignitionOn ? t('map.popup.ignitionOn') : t('map.popup.ignitionOff')}
              />
              <Fact icon={Gauge} label={t('map.popup.odometer')} value={fmtKm(data.odometer)} />
              <Fact
                icon={User}
                label={t('map.popup.driver')}
                value={data.driver ?? t('map.popup.unassigned')}
              />
              <Fact icon={Tag} label={t('map.popup.trip')} value={data.tripId ?? '—'} />
            </Box>

            <Fact icon={MapPin} label={t('map.popup.address')} value={data.address} fullWidth />

            {/* ── Quick actions ── */}
            <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
              {t('map.popup.actions')}
            </Typography>
            <Stack direction="row" gap={1} sx={{ flexWrap: 'wrap', mb: 2 }}>
              <ActionButton icon={Navigation} label={t('map.popup.follow')} primary />
              <ActionButton icon={Video} label={t('map.popup.liveVideo')} />
              <ActionButton icon={History} label={t('map.popup.tripTimeline')} />
              <ActionButton icon={Send} label={t('map.popup.sendMessage')} />
              <ActionButton icon={History} label={t('map.popup.history')} />
            </Stack>

            <Divider sx={{ my: 1 }} />

            {/* ── Recent events ── */}
            <Typography variant="subtitle2" sx={{ mt: 1, mb: 1 }}>
              {t('map.popup.recentEvents')}
            </Typography>
            {data.events.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t('map.popup.noEvents')}
              </Typography>
            ) : (
              <Stack gap={0.5}>
                {data.events.map((e) => (
                  <Stack key={e.id} direction="row" alignItems="center" gap={1}>
                    <Box
                      component="span"
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: SEVERITY_COLOR[e.severity],
                        flexShrink: 0,
                      }}
                    />
                    <Typography variant="body2" sx={{ flex: 1 }}>
                      {t(`dashboard.alerts.${e.type}`)}
                      <Typography component="span" variant="caption" color="text.secondary">
                        {' · '}
                        {e.detail}
                      </Typography>
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </Box>
        )}
      </Stack>
    </Drawer>
  );
}

/** Compact key/value fact with an icon. */
function Fact({
  icon: Icon,
  label,
  value,
  fullWidth,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  fullWidth?: boolean;
}) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={1}
      sx={{ gridColumn: fullWidth ? '1 / -1' : undefined, minWidth: 0 }}
    >
      <Icon size={15} color="var(--mui-palette-text-secondary)" />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" component="div">
          {label}
        </Typography>
        <Typography
          variant="body2"
          fontWeight={500}
          noWrap
          sx={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {value}
        </Typography>
      </Box>
    </Stack>
  );
}

/** Presentational quick-action button (§2.5 — actions deferred to later sprints). */
function ActionButton({
  icon: Icon,
  label,
  primary,
}: {
  icon: LucideIcon;
  label: string;
  primary?: boolean;
}) {
  return (
    <Button
      size="small"
      variant={primary ? 'contained' : 'outlined'}
      startIcon={<Icon size={15} />}
      sx={{ textTransform: 'none' }}
      onClick={() => {
        /* Actions deferred to later sprints. */
      }}
    >
      {label}
    </Button>
  );
}

/** Format kilometers with thousands separators. */
function fmtKm(km: number): string {
  return `${km.toLocaleString('en-US')} km`;
}
