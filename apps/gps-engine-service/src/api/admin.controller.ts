/**
 * Admin controller — operational telemetry for the ingestion pipeline
 * (Sprint D §16: "a safe operational mechanism to inspect DLQ messages").
 *
 * NOT a DLQ UI: a minimal, authenticated read-only surface over the consumer's
 * in-memory DLQ audit ring (metadata only — topic/partition/offset/reason/
 * attempts/event-id; never raw payloads, never secrets). Use the Kafka tooling
 * to inspect/reprocess actual DLQ records.
 */
import { RequirePermissions } from '@fleetvision/auth';
import { Controller, Get, Inject } from '@nestjs/common';
import type {
  DlqAuditRecord,
  GpsEngineKafkaConsumer,
} from '../infrastructure/kafka/kafka-consumer.js';
import { KAFKA_CONSUMER } from './tokens.js';

@Controller('admin')
@RequirePermissions('telemetry.gateway.manage')
export class AdminController {
  constructor(@Inject(KAFKA_CONSUMER) private readonly consumer: GpsEngineKafkaConsumer) {}

  /** Consumer liveness + recent DLQ routing decisions (metadata only). */
  @Get('ingestion')
  public getIngestion(): {
    consumerRunning: boolean;
    dlqRecent: readonly DlqAuditRecord[];
  } {
    return {
      consumerRunning: this.consumer.isRunning,
      dlqRecent: this.consumer.dlqAuditRecords,
    };
  }
}
