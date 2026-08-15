import { describe, expect, it } from '@jest/globals';
import { EnvelopeValidationError } from '../infrastructure/kafka/envelope-parser.js';
import {
  KafkaMessageProcessor,
  type DlqAuditRecord,
} from '../infrastructure/kafka/message-processor.js';
import type { DlqEntry, DlqProducer } from '../infrastructure/kafka/dlq-producer.js';

/**
 * Sprint D §15/§16/§18/§19 — consumer reliability semantics (no broker needed):
 * bounded retry, non-retryable classification, DLQ routing, and the
 * documented drop edge when the DLQ itself is unreachable.
 */

function msg(value: string | Buffer): {
  topic: string;
  partition: number;
  offset: string;
  key: Buffer | null;
  value: Buffer;
} {
  return {
    topic: 'fleetvision.telemetry.position.raw',
    partition: 0,
    offset: '42',
    key: Buffer.from('device-1'),
    value: typeof value === 'string' ? Buffer.from(value) : value,
  };
}

function makeProcessor(opts: {
  maxAttempts?: number;
  dlq?: DlqProducer | null;
  onDlq?: (r: DlqAuditRecord) => void;
} = {}) {
  const dlqPublished: DlqEntry[] = [];
  const dlq: DlqProducer | null =
    opts.dlq === null
      ? null
      : ({
          dlqTopicFor: (t: string) => `${t}.dlq`,
          publish: async (entry: DlqEntry) => {
            dlqPublished.push(entry);
          },
          ensureTopics: async () => {},
          connect: async () => ({}) as never,
          onApplicationShutdown: async () => {},
        } as unknown as DlqProducer);
  const processor = new KafkaMessageProcessor({
    maxAttempts: opts.maxAttempts ?? 3,
    retryBackoffMs: 1,
    dlq,
    onDlq: opts.onDlq,
  });
  return { processor, dlqPublished };
}

describe('KafkaMessageProcessor — bounded retry + DLQ (Sprint D §15)', () => {
  it('processes a successful message once (no retries)', async () => {
    const { processor } = makeProcessor();
    let calls = 0;
    const outcome = await processor.process(msg('{}'), async () => {
      calls++;
    }, 'position');
    expect(outcome).toBe('processed');
    expect(calls).toBe(1);
  });

  it('retries a transient failure and succeeds on attempt 2', async () => {
    const { processor } = makeProcessor({ maxAttempts: 3 });
    let calls = 0;
    const outcome = await processor.process(
      msg('{}'),
      async () => {
        calls++;
        if (calls < 2) throw new Error('ECONNREFUSED');
      },
      'position',
    );
    expect(outcome).toBe('processed');
    expect(calls).toBe(2);
  });

  it('exhausts bounded retries on persistent failure → DLQ (attempts recorded)', async () => {
    const { processor, dlqPublished } = makeProcessor({ maxAttempts: 3 });
    let calls = 0;
    const outcome = await processor.process(
      msg('{}'),
      async () => {
        calls++;
        throw new Error('relation "tracking.vehicle_positions" does not exist');
      },
      'position',
    );
    expect(outcome).toBe('dlq');
    expect(calls).toBe(3); // 1 + 2 retries — bounded
    expect(dlqPublished).toHaveLength(1);
    expect(dlqPublished[0]?.attempts).toBe(3);
    expect(dlqPublished[0]?.originalTopic).toBe('fleetvision.telemetry.position.raw');
    expect(dlqPublished[0]?.originalTopic && dlqPublished[0]).toMatchObject({
      partition: 0,
      offset: '42',
    });
  });

  it('a malformed envelope (EnvelopeValidationError) is NON-retryable → straight to DLQ', async () => {
    const { processor, dlqPublished } = makeProcessor({ maxAttempts: 5 });
    let calls = 0;
    const outcome = await processor.process(
      msg('not-json{'),
      async () => {
        calls++;
        throw new EnvelopeValidationError('envelope is not valid JSON: boom');
      },
      'position',
    );
    expect(outcome).toBe('dlq');
    expect(calls).toBe(1); // never retried
    expect(dlqPublished[0]?.errorClass).toBe('EnvelopeValidationError');
  });

  it('a retry that surfaces EnvelopeValidationError stops retrying → DLQ', async () => {
    const { processor, dlqPublished } = makeProcessor({ maxAttempts: 4 });
    let calls = 0;
    const outcome = await processor.process(
      msg('{}'),
      async () => {
        calls++;
        if (calls === 1) throw new Error('transient');
        throw new EnvelopeValidationError('envelope missing deviceId');
      },
      'session',
    );
    expect(outcome).toBe('dlq');
    expect(calls).toBe(2);
    expect(dlqPublished[0]?.errorClass).toBe('EnvelopeValidationError');
  });

  it('DLQ metadata carries event/correlation ids extracted from the payload (§34)', async () => {
    const audits: DlqAuditRecord[] = [];
    const { processor } = makeProcessor({ onDlq: (r) => audits.push(r) });
    const outcome = await processor.process(
      msg(
        JSON.stringify({
          messageId: 'evt-1',
          correlationId: 'corr-1',
          deviceId: 'd',
        }),
      ),
      async () => {
        throw new EnvelopeValidationError('envelope missing position');
      },
      'position',
    );
    expect(outcome).toBe('dlq');
    expect(audits[0]?.eventId).toBe('evt-1');
    expect(audits[0]?.correlationId).toBe('corr-1');
  });

  it('when the DLQ sink itself fails the message is DROPPED (counted, never throws, §15 edge)', async () => {
    const failingDlq = {
      dlqTopicFor: (t: string) => `${t}.dlq`,
      publish: async () => {
        throw new Error('DLQ unreachable');
      },
      ensureTopics: async () => {},
      connect: async () => ({}) as never,
      onApplicationShutdown: async () => {},
    } as unknown as DlqProducer;
    const processor = new KafkaMessageProcessor({
      maxAttempts: 1,
      retryBackoffMs: 1,
      dlq: failingDlq,
    });
    await expect(
      processor.process(
        msg('{}'),
        async () => {
          throw new Error('db down');
        },
        'position',
      ),
    ).resolves.toBe('dropped'); // never throws — the consumer survives (§19)
  });

  it('no DLQ sink (tests) → drop outcome, no crash', async () => {
    const { processor } = makeProcessor({ dlq: null });
    await expect(
      processor.process(
        msg('{}'),
        async () => {
          throw new Error('boom');
        },
        'position',
      ),
    ).resolves.toBe('dropped');
  });
});
