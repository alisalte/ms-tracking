/**
 * DeviceParameterPanel — Parameter tab shell with shipped section sub-nav.
 */
import { useTranslation } from 'react-i18next';

import { DeviceParameterAiPanel } from '@/components/commands/DeviceParameterAiPanel';
import { DeviceParameterAlarmPanel } from '@/components/commands/DeviceParameterAlarmPanel';
import { DeviceParameterAlertsPanel } from '@/components/commands/DeviceParameterAlertsPanel';
import { DeviceParameterMediaPanel } from '@/components/commands/DeviceParameterMediaPanel';
import { DeviceParameterNetworkPanel } from '@/components/commands/DeviceParameterNetworkPanel';
import { DeviceParameterTrackingPanel } from '@/components/commands/DeviceParameterTrackingPanel';
import { Tabs } from '@/components/tailwind-ui';
import {
  SHIPPED_PARAMETER_SECTIONS,
  type ShippedParameterSectionId,
} from '@/lib/device-parameter-state';

export const PARAMETER_SECTIONS = SHIPPED_PARAMETER_SECTIONS;
export type ParameterSection = ShippedParameterSectionId;

export function readParameterSection(value: string | null): ParameterSection {
  if (
    value === 'network' ||
    value === 'tracking' ||
    value === 'alerts' ||
    value === 'media' ||
    value === 'ai'
  ) {
    return value;
  }
  return 'alarm';
}

interface DeviceParameterPanelProps {
  deviceIds: string[];
  disabled?: boolean;
  section: ParameterSection;
  onSectionChange: (section: ParameterSection) => void;
}

export function DeviceParameterPanel({
  deviceIds,
  disabled = false,
  section,
  onSectionChange,
}: DeviceParameterPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4" data-testid="device-parameter-panel">
      <Tabs
        aria-label={t('commands.parameter.sectionsLabel', {
          defaultValue: 'Parameter sections',
        })}
        value={section}
        onChange={onSectionChange}
        tabs={[
          {
            value: 'alarm',
            label: t('commands.parameter.sections.alarm', { defaultValue: 'Alarm' }),
            testid: 'parameter-section-alarm',
          },
          {
            value: 'network',
            label: t('commands.parameter.sections.network', { defaultValue: 'Network' }),
            testid: 'parameter-section-network',
          },
          {
            value: 'tracking',
            label: t('commands.parameter.sections.tracking', { defaultValue: 'Tracking' }),
            testid: 'parameter-section-tracking',
          },
          {
            value: 'alerts',
            label: t('commands.parameter.sections.alerts', { defaultValue: 'Alerts' }),
            testid: 'parameter-section-alerts',
          },
          {
            value: 'media',
            label: t('commands.parameter.sections.media', { defaultValue: 'Media' }),
            testid: 'parameter-section-media',
          },
          {
            value: 'ai',
            label: t('commands.parameter.sections.ai', { defaultValue: 'AI / C90' }),
            testid: 'parameter-section-ai',
          },
        ]}
      />

      {section === 'alarm' && (
        <div id="panel-alarm" role="tabpanel">
          <DeviceParameterAlarmPanel deviceIds={deviceIds} disabled={disabled} />
        </div>
      )}
      {section === 'network' && (
        <div id="panel-network" role="tabpanel">
          <DeviceParameterNetworkPanel deviceIds={deviceIds} disabled={disabled} />
        </div>
      )}
      {section === 'tracking' && (
        <div id="panel-tracking" role="tabpanel">
          <DeviceParameterTrackingPanel deviceIds={deviceIds} disabled={disabled} />
        </div>
      )}
      {section === 'alerts' && (
        <div id="panel-alerts" role="tabpanel">
          <DeviceParameterAlertsPanel deviceIds={deviceIds} disabled={disabled} />
        </div>
      )}
      {section === 'media' && (
        <div id="panel-media" role="tabpanel">
          <DeviceParameterMediaPanel deviceIds={deviceIds} disabled={disabled} />
        </div>
      )}
      {section === 'ai' && (
        <div id="panel-ai" role="tabpanel">
          <DeviceParameterAiPanel deviceIds={deviceIds} disabled={disabled} />
        </div>
      )}
    </div>
  );
}
