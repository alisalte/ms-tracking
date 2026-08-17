/**
 * Kafka producer + command-request consumer — public surface (06 §13.2).
 */
export {
  DeviceGatewayKafkaProducer,
  type KafkaProducerOptions,
} from './kafka-producer.js';
export {
  CommandRequestConsumer,
  type CommandRequestConsumerOptions,
} from './command-request-consumer.js';
