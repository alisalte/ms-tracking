import { describe, expect, it, jest } from '@jest/globals';

import type { FleetManagementConfig } from '../config/fleet-management.config.js';
import { CommandAckConsumer } from '../infrastructure/kafka/command-ack-consumer.js';
import type { DeviceCommandRepository } from '../infrastructure/persistence/device-command.repository.js';
import type { EvidenceCaptureRepository } from '../infrastructure/persistence/evidence-capture.repository.js';

const TENANT = '11111111-1111-1111-1111-111111111111';
const DEVICE = '22222222-2222-2222-2222-222222222222';
const PHOTO = '20261019055951_CH1_dca.jpg';

function photoAck() {
  return {
    message: {
      value: Buffer.from(
        JSON.stringify({
          type: 'telemetry.command.ack.v1',
          tenantId: TENANT,
          deviceId: DEVICE,
          telemetry: {
            command: 'D00',
            filename: PHOTO,
            photoBase64: Buffer.from('jpeg').toString('base64'),
            byteLength: 4,
            response: 'OK',
          },
        }),
      ),
      headers: {},
    },
  };
}

describe('CommandAckConsumer — D00 photo replies', () => {
  it('matches the D00 for that file and completes every evidence row waiting for it', async () => {
    // The alarm page's D00 (not an evidence command) is the one the device answered.
    const latestPendingByCode = jest.fn(async () => ({ id: 'browser-d00' }));
    const markAcked = jest.fn(async () => undefined);
    const commands = { latestPendingByCode, markAcked } as unknown as DeviceCommandRepository;
    const findByCommandId = jest.fn(async () => null);
    const markPhotoReady = jest.fn(async () => undefined);
    const markPhotoReadyByName = jest.fn(async () => 1);
    const evidence = {
      findByCommandId,
      markPhotoReady,
      markPhotoReadyByName,
    } as unknown as EvidenceCaptureRepository;

    const consumer = new CommandAckConsumer({} as FleetManagementConfig, commands, evidence);
    await (consumer as unknown as { eachMessage: (p: unknown) => Promise<void> }).eachMessage(
      photoAck(),
    );

    expect(latestPendingByCode).toHaveBeenCalledWith(TENANT, DEVICE, 'D00', PHOTO);
    expect(markAcked).toHaveBeenCalled();
    // Before: only the command-id lookup ran, found nothing, and the evidence
    // row stayed FETCHING forever.
    expect(markPhotoReady).not.toHaveBeenCalled();
    expect(markPhotoReadyByName).toHaveBeenCalledWith(
      TENANT,
      DEVICE,
      PHOTO,
      Buffer.from('jpeg'),
      'image/jpeg',
    );
  });
});
