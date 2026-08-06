/**
 * Built-in protocol adapters (06 §2.1). One module per vendor.
 *
 * Sprint 3 shipped GT06 (the reference, most-cloned protocol) + a stub adapter
 * (exercising the plugin/pipeline path without a real vendor format). Sprint 4
 * added Meitrack (Taiwan — MVT380/MT90/P99B). Sprint 8 adds JT808 (Chinese
 * national JT/T 808-2019 commercial-vehicle protocol). The remaining protocols
 * (JT1078, Teltonika, Concox, Queclink) are later-sprint adapter modules against
 * the same ProtocolAdapter contract.
 */
import { Gt06Adapter } from './gt06/gt06.adapter.js';
import { Jt808Adapter } from './jt808/jt808.adapter.js';
import { MeitrackAdapter } from './meitrack/meitrack.adapter.js';
import { StubAdapter } from './stub/stub.adapter.js';

export { Gt06Adapter } from './gt06/gt06.adapter.js';
export { Jt808Adapter } from './jt808/jt808.adapter.js';
export { MeitrackAdapter } from './meitrack/meitrack.adapter.js';
export { StubAdapter } from './stub/stub.adapter.js';

/**
 * The built-in adapter instances registered on bootstrap (06 §9.3 built-in mode).
 */
export const BUILTIN_ADAPTERS = [
  new Gt06Adapter(),
  new Jt808Adapter(),
  new MeitrackAdapter(),
  new StubAdapter(),
] as const;
