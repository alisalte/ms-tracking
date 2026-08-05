/**
 * Built-in protocol adapters (06 §2.1). One module per vendor.
 *
 * Sprint 3 ships GT06 (the reference, most-cloned protocol) + a stub adapter
 * (exercises the plugin/pipeline path without a real vendor format). The other
 * six protocols (JT808, JT1078, Teltonika, Meitrack, Concox, Queclink) are
 * later-sprint adapter modules against the same ProtocolAdapter contract.
 */
import { Gt06Adapter } from './gt06/gt06.adapter.js';
import { StubAdapter } from './stub/stub.adapter.js';

export { Gt06Adapter } from './gt06/gt06.adapter.js';
export { StubAdapter } from './stub/stub.adapter.js';

/**
 * The built-in adapter instances registered on bootstrap (06 §9.3 built-in mode).
 */
export const BUILTIN_ADAPTERS = [new Gt06Adapter(), new StubAdapter()] as const;
