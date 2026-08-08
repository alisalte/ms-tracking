import { UpcomingFeature } from '@/components/common/UpcomingFeature';
/**
 * CommandCenterPage — device command dispatch (`/commands`).
 *
 * TODO: Backend dependency — device-gateway-service has no command-dispatch
 * REST endpoint yet. The typed contract is defined in `types/command.types.ts`.
 * When the backend lands `POST /devices/:id/commands`, this page will render
 * the command list, dispatch dialog, confirmation, and history.
 */
import { Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function CommandCenterPage() {
  const { t } = useTranslation();
  return (
    <UpcomingFeature
      title={t('commands.title', { defaultValue: 'Command Center' })}
      description={t('commands.description', {
        defaultValue:
          'Send commands to devices — request position, reboot, lock/unlock, engine cut, configuration, and OTA firmware updates.',
      })}
      backendDependency="device-gateway-service: POST /devices/:id/commands"
      icon={Terminal}
    />
  );
}
