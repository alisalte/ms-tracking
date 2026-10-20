import { describe, expect, it, jest } from '@jest/globals';
import { DeviceMessage } from '../domain/index.js';
import { DeviceGatewayKafkaProducer } from '../infrastructure/kafka/kafka-producer.js';

const NOW = new Date('2026-10-20T19:31:00Z');
const TOPICS = {
  position: 'fleetvision.telemetry.position.raw',
  alarm: 'fleetvision.telemetry.alarm.raw',
  device: 'fleetvision.telemetry.device.raw',
  commandAck: 'fleetvision.telemetry.command.ack',
  session: 'fleetvision.telemetry.session.lifecycle',
};

function telemetry(): DeviceMessage {
  return new DeviceMessage({
    messageId: 'm1',
    deviceId: 'dev-1',
    serialOrImei: 'imei-1',
    tenantId: 't-1',
    protocolId: 'meitrack',
    type: 'TELEMETRY',
    timestamp: NOW,
    ingestedAt: NOW,
    rawSize: 2,
    checksum: 'abc',
    direction: 'INBOUND',
  });
}

/** Producer wired to in-memory fakes standing in for kafkajs' admin + producer. */
function build(existingTopics: string[]) {
  const created: string[] = [];
  const sent: string[] = [];
  const known = new Set(existingTopics);
  const admin = {
    connect: jest.fn(async () => undefined),
    disconnect: jest.fn(async () => undefined),
    listTopics: jest.fn(async () => [...known]),
    createTopics: jest.fn(async ({ topics }: { topics: { topic: string }[] }) => {
      for (const { topic } of topics) {
        known.add(topic);
        created.push(topic);
      }
      return true;
    }),
  };
  const kafkaProducer = {
    events: { CONNECT: 'c', DISCONNECT: 'd' },
    on: jest.fn(),
    connect: jest.fn(async () => undefined),
    disconnect: jest.fn(async () => undefined),
    send: jest.fn(async ({ topic }: { topic: string }) => {
      if (!known.has(topic)) {
        throw Object.assign(new Error('This server does not host this topic-partition'), {
          type: 'UNKNOWN_TOPIC_OR_PARTITION',
        });
      }
      sent.push(topic);
    }),
  };
  const producer = new DeviceGatewayKafkaProducer({
    brokers: ['localhost:9092'],
    clientId: 'test',
    topics: TOPICS,
  });
  // biome-ignore lint/suspicious/noExplicitAny: swap the kafkajs client for fakes
  (producer as any).kafka = { admin: () => admin, producer: () => kafkaProducer };
  return { producer, created, sent, kafkaProducer };
}

describe('DeviceGatewayKafkaProducer — topic provisioning', () => {
  it('creates the topics nobody consumes (device.raw) so TELEMETRY/LOGIN publishes succeed', async () => {
    const { producer, created, sent } = build([
      TOPICS.position,
      TOPICS.alarm,
      TOPICS.commandAck,
      TOPICS.session,
    ]);
    await producer.publish(telemetry());
    expect(created).toEqual([TOPICS.device]); // only the missing one
    expect(sent).toEqual([TOPICS.device]);
  });

  it('creates a topic that disappears after connect and retries the send once', async () => {
    const all = Object.values(TOPICS);
    const { producer, created, sent, kafkaProducer } = build(all);
    await producer.connect();
    // Topic deleted behind our back after the producer connected.
    // biome-ignore lint/suspicious/noExplicitAny: reach the fake's backing set
    const admin = (producer as any).kafka.admin();
    admin.listTopics.mockImplementation(async () => all.filter((t) => t !== TOPICS.device));
    kafkaProducer.send.mockImplementationOnce(async () => {
      throw Object.assign(new Error('This server does not host this topic-partition'), {
        type: 'UNKNOWN_TOPIC_OR_PARTITION',
      });
    });
    // biome-ignore lint/suspicious/noExplicitAny: bypass the 30s throttle for the test
    (producer as any).lastEnsureAt = 0;
    await producer.publish(telemetry());
    expect(created).toContain(TOPICS.device);
    expect(sent).toEqual([TOPICS.device]);
  });

  it('surfaces non-topic errors without retrying', async () => {
    const { producer, kafkaProducer } = build(Object.values(TOPICS));
    kafkaProducer.send.mockImplementationOnce(async () => {
      throw new Error('broker down');
    });
    await expect(producer.publish(telemetry())).rejects.toThrow('broker down');
    expect(kafkaProducer.send).toHaveBeenCalledTimes(1);
  });
});
