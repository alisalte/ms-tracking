/**
 * AlarmDetailDrawer — the right slide-over showing the full alarm entity
 * (12_Alarm_Engine.md §6.1), the operator actions (§5.3 ack/resolve/contest),
 * and the linked artifacts (§5.4 — source events, position, driver/vehicle,
 * clip/trip links).
 *
 * Follows the UI_UX §0.6 "selection → detail" pattern (row/marker → right
 * Drawer, never navigate away); Esc or backdrop closes.
 */
import {
  Car,
  ClipboardCheck,
  Clock,
  Flag,
  MapPin,
  ShieldQuestion,
  Truck,
  Video,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useAlarmDetail, useTransitionAlarm } from '@/api/alarm.api';
import { AlarmStatusBadge } from '@/components/alarms/AlarmStatusBadge';
import { alarmTypeIcon, severityColor } from '@/components/alarms/AlarmTypeIcon';
import type { Alarm } from '@/types/alarm.types';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';

/** Drawer width — slide-over (UI_UX §0.5 Drawer). */
const DRAWER_WIDTH = 420;

interface AlarmDetailDrawerProps {
  /** The selected alarm id, or null to keep the drawer closed. */
  alarmId: string | null;
  /** Close the drawer. */
  onClose: () => void;
}

export function AlarmDetailDrawer({ alarmId, onClose }: AlarmDetailDrawerProps) {
  const { t } = useTranslation();
  const { data: alarm, isLoading } = useAlarmDetail(alarmId);
  const transition = useTransitionAlarm();

  return (
    <Drawer
      anchor="right"
      open={Boolean(alarmId)}
      onClose={onClose}
      variant="temporary"
      sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH, maxWidth: '100vw' } }}
    >
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : alarm ? (
        <AlarmDetailContent
          alarm={alarm}
          onClose={onClose}
          onAction={(status) => transition.mutate({ id: alarm.id, status })}
          acting={transition.isPending}
        />
      ) : (
        <Box sx={{ p: 4 }}>
          <Typography color="text.secondary">{t('alarms.detail.notFound')}</Typography>
        </Box>
      )}
    </Drawer>
  );
}

/** The drawer body — extracted so the alarm is non-null inside it. */
function AlarmDetailContent({
  alarm,
  onClose,
  onAction,
  acting,
}: {
  alarm: Alarm;
  onClose: () => void;
  onAction: (status: Alarm['status']) => void;
  acting: boolean;
}) {
  const { t } = useTranslation();
  const Icon = alarmTypeIcon(alarm.type);
  const sevColor = severityColor(alarm.severity);
  const isResolved = alarm.status === 'resolved';

  return (
    <Stack sx={{ height: '100%', overflowY: 'auto' }}>
      {/* Header */}
      <Stack
        direction="row"
        alignItems="center"
        gap={1.5}
        sx={{
          p: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
          position: 'sticky',
          top: 0,
          bgcolor: 'background.paper',
          zIndex: 1,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 40,
            height: 40,
            borderRadius: 2,
            bgcolor: sevColor,
            color: '#fff',
            flexShrink: 0,
          }}
        >
          <Icon size={20} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }} noWrap>
            {alarm.message}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {alarm.vehicleLabel} · {t(`alarms.severity.${alarm.severity}`)}
          </Typography>
        </Box>
        <AlarmStatusBadge status={alarm.status} label={t(`alarms.status.${alarm.status}`)} />
      </Stack>

      <Stack gap={2.5} sx={{ p: 2 }}>
        {/* Meta grid */}
        <Stack gap={1}>
          <DetailRow
            icon={<Truck size={16} />}
            label={t('alarms.detail.vehicle')}
            value={alarm.vehicleLabel}
          />
          {alarm.driver && (
            <DetailRow
              icon={<Car size={16} />}
              label={t('alarms.detail.driver')}
              value={alarm.driver}
            />
          )}
          <DetailRow
            icon={<MapPin size={16} />}
            label={t('alarms.detail.location')}
            value={alarm.address}
          />
          <DetailRow
            icon={<Clock size={16} />}
            label={t('alarms.detail.raised')}
            value={fmt(alarm.raisedAt)}
          />
          {alarm.ackedAt && (
            <DetailRow
              icon={<ClipboardCheck size={16} />}
              label={t('alarms.detail.acked')}
              value={fmt(alarm.ackedAt)}
            />
          )}
          {alarm.resolvedAt && (
            <DetailRow
              icon={<ShieldQuestion size={16} />}
              label={t('alarms.detail.resolved')}
              value={fmt(alarm.resolvedAt)}
            />
          )}
          {alarm.escalationStep > 0 && (
            <DetailRow
              icon={<Flag size={16} />}
              label={t('alarms.detail.escalation')}
              value={t('alarms.detail.escalationStep', { step: alarm.escalationStep })}
            />
          )}
        </Stack>

        {/* Detail / description */}
        {alarm.detail && (
          <Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}
            >
              {t('alarms.detail.description')}
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {alarm.detail}
            </Typography>
          </Box>
        )}

        {/* Source events */}
        <Box>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}
          >
            {t('alarms.detail.sourceEvents')}
          </Typography>
          <Stack gap={0.5} sx={{ mt: 0.5 }}>
            {alarm.sourceEvents.map((e) => (
              <Box
                key={e.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  fontSize: '0.8rem',
                  color: 'text.secondary',
                }}
              >
                <Chip
                  size="small"
                  label={e.type}
                  sx={{ height: 18, fontSize: '0.6rem', fontFamily: 'monospace' }}
                />
                <span>{e.detail}</span>
              </Box>
            ))}
          </Stack>
        </Box>

        {/* Linked artifacts */}
        {(alarm.linkedClipId || alarm.linkedTripId) && (
          <Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}
            >
              {t('alarms.detail.linked')}
            </Typography>
            <Stack direction="row" gap={1} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
              {alarm.linkedClipId && (
                <Button size="small" startIcon={<Video size={14} />} component={Link} to="/video">
                  {t('alarms.detail.viewClip')}
                </Button>
              )}
              {alarm.linkedTripId && (
                <Button
                  size="small"
                  startIcon={<MapPin size={14} />}
                  component={Link}
                  to={`/trips/${alarm.linkedTripId}`}
                >
                  {t('alarms.detail.viewTrip')}
                </Button>
              )}
            </Stack>
          </Box>
        )}

        <Divider />

        {/* Operator actions (§5.3) */}
        <Stack direction="row" gap={1} sx={{ flexWrap: 'wrap' }}>
          {!isResolved && alarm.status !== 'acked' && (
            <Button
              size="small"
              variant="contained"
              color="primary"
              disabled={acting}
              onClick={() => onAction('acked')}
            >
              {t('alarms.actions.ack')}
            </Button>
          )}
          {!isResolved && (
            <Button
              size="small"
              variant="outlined"
              disabled={acting}
              onClick={() => onAction('resolved')}
            >
              {t('alarms.actions.resolve')}
            </Button>
          )}
          {!isResolved && (
            <Button
              size="small"
              variant="text"
              color="warning"
              disabled={acting}
              onClick={() => onAction('resolved')}
            >
              {t('alarms.actions.contest')}
            </Button>
          )}
        </Stack>
      </Stack>

      {/* Close affordance (Esc also works via the Drawer). */}
      <IconButton
        onClick={onClose}
        aria-label={t('common.close')}
        sx={{ position: 'absolute', top: 8, right: 8 }}
      />
    </Stack>
  );
}

/** A key/value row with a leading icon. */
function DetailRow({
  icon,
  label,
  value,
}: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box sx={{ color: 'text.secondary', display: 'flex' }}>{icon}</Box>
      <Typography variant="body2" sx={{ minWidth: 90, color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ flex: 1 }} noWrap>
        {value}
      </Typography>
    </Box>
  );
}

/** Locale-aware timestamp formatter. */
function fmt(iso: string): string {
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}
