import { useCallback, useEffect, useRef, useState } from 'react';
/**
 * useRealtimeSocket — base Socket.IO connection hook with automatic reconnect.
 *
 * Connects to a backend WebSocket (gps-engine, media-service, etc.) and provides:
 * - Connection state (connecting / connected / disconnected / error)
 * - Automatic reconnect with exponential backoff (1s → 2s → 4s → … max 30s)
 * - Retry limit (max 10 attempts before giving up)
 * - Clean teardown on unmount
 * - Event subscription via a stable ref pattern
 *
 * The hook is transport-agnostic — callers register event handlers and get
 * notified. It does NOT know about positions or alarms; those are built on top.
 */
import { type Socket, io } from 'socket.io-client';

import { getAccessToken } from '@/auth/token.storage';

/** Connection state machine. */
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

/** Configuration for the socket hook. */
export interface RealtimeSocketOptions {
  /** WebSocket URL (e.g. ws://localhost:3001 or the page origin). */
  url: string;
  /** Socket.IO path (default `/socket.io`). Use `/gps-ws/socket.io` behind nginx. */
  path?: string;
  /** Whether to enable the connection (false = don't connect). */
  enabled?: boolean;
  /** Maximum reconnect attempts before giving up (default 10). */
  maxRetries?: number;
  /** Base backoff delay in ms (default 1000). */
  baseDelayMs?: number;
  /** Maximum backoff delay in ms (default 30000). */
  maxDelayMs?: number;
}

/** Internal state tracked across reconnects. */
interface SocketState {
  socket: Socket | null;
  retryCount: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Connect to a Socket.IO server with automatic reconnection.
 *
 * Returns the connection state + a subscribe function to register event
 * handlers. The subscribe function is stable (useRef) so callers can safely
 * use it in useEffect without re-triggering.
 */
export function useRealtimeSocket(options: RealtimeSocketOptions) {
  const {
    url,
    path = '/socket.io',
    enabled = true,
    maxRetries = 10,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
  } = options;
  const [state, setState] = useState<ConnectionState>('disconnected');
  const stateRef = useRef<SocketState>({ socket: null, retryCount: 0, reconnectTimer: null });
  const handlersRef = useRef<Map<string, Set<(data: unknown) => void>>>(new Map());

  /** Compute exponential backoff delay (capped at maxDelayMs). */
  const backoffDelay = (attempt: number) => Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);

  /** Clean up the current socket + timer. */
  const cleanup = useCallback(() => {
    if (stateRef.current.reconnectTimer) {
      clearTimeout(stateRef.current.reconnectTimer);
      stateRef.current.reconnectTimer = null;
    }
    if (stateRef.current.socket) {
      stateRef.current.socket.removeAllListeners();
      stateRef.current.socket.disconnect();
      stateRef.current.socket = null;
    }
  }, []);

  /** Connect (or reconnect) to the server. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: scheduleReconnect/backoffDelay are closures using refs
  const connect = useCallback(() => {
    if (!enabled) return;

    cleanup();
    setState('connecting');

    const socket = io(url, {
      path,
      transports: ['websocket'],
      reconnection: false,
      timeout: 10000,
      // Sprint 1 WS gateway hardening: the handshake must carry the JWT so the
      // server can authenticate + enforce tenant-scoped room joins. Without it
      // the connection is rejected (no unauthenticated WS access).
      auth: { token: getAccessToken() },
    });
    stateRef.current.socket = socket;

    // Re-register all existing handlers on the new socket.
    for (const [event, handlers] of handlersRef.current) {
      for (const handler of handlers) {
        socket.on(event, handler);
      }
    }

    socket.on('connect', () => {
      stateRef.current.retryCount = 0;
      setState('connected');
    });

    socket.on('disconnect', () => {
      setState('disconnected');
      scheduleReconnect();
    });

    socket.on('connect_error', () => {
      setState('error');
      scheduleReconnect();
    });

    function scheduleReconnect() {
      if (stateRef.current.retryCount >= maxRetries) return;
      const delay = backoffDelay(stateRef.current.retryCount);
      stateRef.current.retryCount += 1;
      stateRef.current.reconnectTimer = setTimeout(() => connect(), delay);
    }
  }, [url, path, enabled, cleanup, maxRetries]);

  // Connect on mount / when enabled changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: connect/cleanup use stable refs
  useEffect(() => {
    if (enabled) {
      connect();
    }
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, path, enabled]);

  /**
   * Subscribe to a server event. Returns an unsubscribe function.
   * The handler is stored in a ref so it survives reconnections.
   */
  const subscribe = useCallback((event: string, handler: (data: unknown) => void) => {
    const set = handlersRef.current.get(event) ?? new Set();
    set.add(handler);
    handlersRef.current.set(event, set);
    stateRef.current.socket?.on(event, handler);
    return () => {
      set.delete(handler);
      stateRef.current.socket?.off(event, handler);
    };
  }, []);

  /** Emit an event to the server (e.g. `subscribe` to a room). */
  const emit = useCallback((event: string, ...args: unknown[]) => {
    stateRef.current.socket?.emit(event, ...args);
  }, []);

  return { state, subscribe, emit, reconnect: connect };
}
