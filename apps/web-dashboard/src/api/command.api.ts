/**
 * Device Commands API + data hooks — REAL fleet-management backend
 * (06 §11.3 SendDeviceCommand; Meitrack MDVR GPRS Protocol V2.0).
 *
 *   GET  /device-commands/catalog          → { data: CommandDef[] }
 *   GET  /device-commands/:id              → { data: DeviceCommandRecord }
 *   POST /devices/:deviceId/commands       { commandCode, params?, ttlSec? }
 *   GET  /devices/:deviceId/commands       (?cursor&limit&status&commandCode)
 *                                           → Page<DeviceCommandRecord>
 *
 * History polls (refetchInterval) so QUEUED → SENT → ACKED/FAILED transitions
 * surface without user action — the ack path is asynchronous (device D82 reply
 * via Kafka). Mock mode (`?useMock=true`) substitutes a deterministic fixture
 * catalog/history; production is real-only.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { resolveMock, shouldUseMock, withMockFallback } from '@/lib/mock-gate';
import { mockCommandCatalog, mockCommandHistory } from '@/mock/command-data';
import type { Page } from '@/types/api.types';
import type {
  CommandDef,
  CommandStatus,
  DeviceCommandRecord,
  SendCommandPayload,
} from '@/types/command.types';
import { apiGet, apiGetRaw, apiPost } from './client';
import { queryKeys } from './query-keys';

// ── Fetchers ─────────────────────────────────────────────────────────────────

async function fetchCatalog(): Promise<CommandDef[]> {
  if (shouldUseMock()) return resolveMock(mockCommandCatalog());
  return withMockFallback(
    async () => (await apiGet<CommandDef[]>('/device-commands/catalog')).slice(),
    () => resolveMock(mockCommandCatalog()),
  );
}

async function fetchHistory(
  deviceId: string | null,
  status?: CommandStatus,
): Promise<DeviceCommandRecord[]> {
  const real = async (): Promise<DeviceCommandRecord[]> => {
    if (!deviceId) return [];
    const page = await apiGetRaw<Page<DeviceCommandRecord>>(`/devices/${deviceId}/commands`, {
      limit: 200,
      ...(status ? { status } : {}),
    });
    return page.data;
  };
  if (shouldUseMock()) {
    return resolveMock(mockCommandHistory(deviceId, status));
  }
  return withMockFallback(real, () => resolveMock(mockCommandHistory(deviceId, status)));
}

async function sendCommand(
  deviceId: string,
  payload: SendCommandPayload,
): Promise<DeviceCommandRecord> {
  return apiPost<SendCommandPayload, DeviceCommandRecord>(`/devices/${deviceId}/commands`, payload);
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/** The Meitrack MDVR command catalog (UI form source of truth). */
export function useCommandCatalog() {
  return useQuery({
    queryKey: queryKeys.commands.catalog(),
    queryFn: fetchCatalog,
    staleTime: 5 * 60_000,
  });
}

/**
 * Command history for a device (null = none selected). Polls while any row is
 * in-flight (QUEUED/SENT) so ack transitions appear without a manual refresh.
 */
export function useCommandHistory(deviceId: string | null, status?: CommandStatus) {
  return useQuery({
    queryKey: [...queryKeys.commands.history(deviceId), status ?? 'any'],
    queryFn: () => fetchHistory(deviceId, status),
    enabled: Boolean(deviceId),
    refetchInterval: (query) => {
      const rows = query.state.data;
      const inFlight = rows?.some((r) => r.status === 'QUEUED' || r.status === 'SENT');
      return inFlight ? 3_000 : 15_000;
    },
  });
}

/** Issue a command to a device (invalidates history). */
export function useSendDeviceCommand(deviceId: string | null) {
  const qc = useQueryClient();
  return useMutation<DeviceCommandRecord, Error, SendCommandPayload>({
    mutationFn: (payload) => {
      if (!deviceId) return Promise.reject(new Error('No device selected.'));
      if (shouldUseMock()) {
        return resolveMock({
          id: `mock-cmd-${Date.now()}`,
          tenantId: 'mock-tenant',
          deviceId,
          commandCode: payload.commandCode,
          category: 'system',
          params: payload.params ?? null,
          payloadText: null,
          payloadHex: null,
          status: 'QUEUED' as CommandStatus,
          responseText: null,
          error: null,
          issuedBy: 'mock-user',
          issuedAt: new Date().toISOString(),
          sentAt: null,
          ackedAt: null,
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      return sendCommand(deviceId, payload);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.commands.all });
    },
  });
}
