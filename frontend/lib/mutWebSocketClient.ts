/**
 * MUT WebSocket client — server-push commit_update consumer.
 *
 * One persistent WebSocket per (project_id, browser tab). The connection
 * stays open as long as any subscriber is registered; it auto-reconnects
 * with exponential backoff if the server drops it.
 *
 * Auth contract (see backend ``mut_engine/routers/ws_router.py``):
 *   The browser ``WebSocket`` constructor cannot set arbitrary headers,
 *   so we ship the JWT inside the ``Sec-WebSocket-Protocol`` field as
 *   ``mut.bearer.<token>``. The server pulls the token off, then accepts
 *   the upgrade with a benign ``mut.v1`` subprotocol so the JWT never
 *   appears in the response handshake (proxies log subprotocols).
 *
 * Frame contract:
 *   Every server-pushed frame is JSON. Currently the only kind is
 *   ``{type: "commit_update", ...}`` — see :class:`CommitUpdateEvent`.
 *   Clients that don't recognise a ``type`` should ignore the frame.
 */

import { getApiAccessToken } from './apiClient';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9090';

const _MIN_RECONNECT_DELAY_MS = 1_000;
const _MAX_RECONNECT_DELAY_MS = 30_000;
const _RECONNECT_JITTER_MS = 500;
/** Force a reconnect this many seconds before the JWT's ``exp``. The
 *  server checked auth at the upgrade handshake and never re-verifies,
 *  so a long-idle socket can technically outlive its token. Cycling
 *  early lets ``_connect`` pick up the fresh token supabase-js has
 *  already auto-refreshed. */
const _TOKEN_REFRESH_MARGIN_SECS = 60;
/** Hard cap on the recycle delay. If a token reports an absurdly far
 *  ``exp`` (or we fail to decode it), don't schedule a 30-day timer. */
const _MAX_TOKEN_LIFETIME_MS = 60 * 60 * 1000; // 1h

/**
 * Server → client commit_update frame. Mirrors
 * ``NotificationManager.broadcast_commit_update`` payload on the
 * backend. ``changed_files`` is the project-root-relative path list
 * extracted from the commit's ``changes`` log.
 */
export interface CommitUpdateEvent {
  type: 'commit_update';
  notification_id: string;
  scope: string;            // normalised scope_path; '' = root scope
  commit_id: string;        // 40-hex SHA-1 git commit object hash
  pushed_by: string;        // agent identity, e.g. 'user:<uuid>'
  message: string;
  scope_hash: string;       // 40-hex SHA-1 of the new scope tree
  changed_files: string[];
  timestamp: string;        // ISO 8601 UTC
}

/** Anything else the server may push in the future. */
export interface UnknownEvent {
  type: string;
  [key: string]: unknown;
}

export type MutNotification = CommitUpdateEvent | UnknownEvent;

export type MutNotificationHandler = (event: MutNotification) => void;

type ConnectionState = 'connecting' | 'open' | 'closed';

interface ProjectConnection {
  socket: WebSocket | null;
  state: ConnectionState;
  handlers: Set<MutNotificationHandler>;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  /** Scheduled timer that proactively recycles the socket before its
   *  upgrade-time JWT expires. Without this, a session left open for
   *  many hours holds a connection past the token's ``exp`` — the
   *  server accepted it at handshake and never re-verifies. Cleared
   *  on tear-down. */
  refreshTimer: ReturnType<typeof setTimeout> | null;
  /** Bumped on each ``connect()`` call so stale callbacks (from a
   *  socket whose lifetime ended) can detect they're obsolete and
   *  not schedule a reconnect on top of an already-replaced socket. */
  generation: number;
}

const _connections = new Map<string, ProjectConnection>();

function _wsUrlFor(projectId: string): string {
  // Convert http(s):// → ws(s)://
  const httpBase = API_BASE_URL.replace(/\/$/, '');
  const wsBase = httpBase.replace(/^http(s?):\/\//i, (_m, s) => `ws${s}://`);
  return `${wsBase}/api/v1/mut/${encodeURIComponent(projectId)}/ws`;
}

function _getOrCreate(projectId: string): ProjectConnection {
  let conn = _connections.get(projectId);
  if (!conn) {
    conn = {
      socket: null,
      state: 'closed',
      handlers: new Set(),
      reconnectAttempts: 0,
      reconnectTimer: null,
      refreshTimer: null,
      generation: 0,
    };
    _connections.set(projectId, conn);
  }
  return conn;
}

function _backoffDelayMs(attempt: number): number {
  const base = Math.min(
    _MAX_RECONNECT_DELAY_MS,
    _MIN_RECONNECT_DELAY_MS * Math.pow(2, attempt),
  );
  return base + Math.random() * _RECONNECT_JITTER_MS;
}

/** Pull the ``exp`` claim out of a JWT without verifying. We trust
 *  it because we (a) just got it from supabase-js's session storage,
 *  and (b) only use it to decide *when to recycle* — server-side auth
 *  is what actually enforces validity. Returns ``null`` if the token
 *  is malformed; the caller falls back to ``_MAX_TOKEN_LIFETIME_MS``. */
function _decodeJwtExpMs(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    // Base64url → base64 → utf-8 JSON. ``atob`` is fine for ASCII
    // claims; if anyone ever puts unicode in ``exp`` we have bigger
    // problems.
    const payload = JSON.parse(
      atob(parts[1].replaceAll('-', '+').replaceAll('_', '/')),
    );
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function _scheduleTokenRefresh(
  projectId: string,
  conn: ProjectConnection,
  token: string,
): void {
  if (conn.refreshTimer) {
    clearTimeout(conn.refreshTimer);
    conn.refreshTimer = null;
  }
  const expMs = _decodeJwtExpMs(token);
  let delayMs: number;
  if (expMs === null) {
    // Couldn't decode — fall back to "recycle after the cap" so we
    // never hold a connection forever on a stale token.
    delayMs = _MAX_TOKEN_LIFETIME_MS;
  } else {
    const remainingMs = expMs - Date.now() - _TOKEN_REFRESH_MARGIN_SECS * 1000;
    delayMs = Math.min(_MAX_TOKEN_LIFETIME_MS, Math.max(60_000, remainingMs));
  }
  const myGen = conn.generation;
  conn.refreshTimer = setTimeout(() => {
    if (conn.generation !== myGen) return; // a newer connect already replaced us
    conn.refreshTimer = null;
    if (conn.socket) {
      // ``onclose`` will schedule the reconnect, which in turn calls
      // ``getApiAccessToken()`` to pick up the post-refresh JWT.
      try {
        conn.socket.close(1000, 'token-refresh');
      } catch {
        /* ignore */
      }
    }
  }, delayMs);
}

async function _connect(projectId: string, conn: ProjectConnection): Promise<void> {
  // Only attempt if there are still subscribers.
  if (conn.handlers.size === 0) {
    conn.state = 'closed';
    return;
  }

  const token = await getApiAccessToken();
  if (!token) {
    // Without a token the upgrade will be 1008'd. Schedule a retry —
    // user may be in the middle of a session refresh.
    _scheduleReconnect(projectId, conn);
    return;
  }

  const myGen = ++conn.generation;
  conn.state = 'connecting';

  let socket: WebSocket;
  try {
    socket = new WebSocket(_wsUrlFor(projectId), [`mut.bearer.${token}`]);
  } catch (err) {
    // URL parse failure or insecure-context constraint — log and back off.
    // eslint-disable-next-line no-console
    console.error('[MutWS] failed to construct WebSocket', err);
    _scheduleReconnect(projectId, conn);
    return;
  }

  conn.socket = socket;

  socket.onopen = () => {
    if (conn.generation !== myGen) return;  // stale callback
    conn.state = 'open';
    conn.reconnectAttempts = 0;
    // Schedule a forced reconnect ~60s before this token expires so
    // the next handshake picks up the supabase-js-refreshed JWT,
    // closing the "long-idle socket outlives its token" gap. Tied to
    // ``myGen`` so a teardown / re-open cycle replaces the timer.
    _scheduleTokenRefresh(projectId, conn, token);
  };

  socket.onmessage = (ev) => {
    if (conn.generation !== myGen) return;
    let parsed: MutNotification;
    try {
      parsed = JSON.parse(ev.data) as MutNotification;
    } catch {
      // Server should only send JSON; bad frame is a server bug.
      // eslint-disable-next-line no-console
      console.warn('[MutWS] dropping non-JSON frame', ev.data);
      return;
    }
    // Fan out to every handler. Each handler is wrapped in try so a
    // single throwing subscriber doesn't break the other subscribers
    // or terminate the message loop.
    for (const h of conn.handlers) {
      try {
        h(parsed);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[MutWS] handler threw', err);
      }
    }
  };

  socket.onerror = () => {
    // ``onerror`` always precedes ``onclose``; we do the actual
    // reconnect bookkeeping in ``onclose`` to avoid double-scheduling.
  };

  socket.onclose = () => {
    if (conn.generation !== myGen) return;
    conn.socket = null;
    conn.state = 'closed';
    if (conn.handlers.size > 0) {
      _scheduleReconnect(projectId, conn);
    }
  };
}

function _scheduleReconnect(projectId: string, conn: ProjectConnection): void {
  if (conn.reconnectTimer) return;
  const delay = _backoffDelayMs(conn.reconnectAttempts);
  conn.reconnectAttempts += 1;
  conn.reconnectTimer = setTimeout(() => {
    conn.reconnectTimer = null;
    void _connect(projectId, conn);
  }, delay);
}

function _teardown(projectId: string, conn: ProjectConnection): void {
  if (conn.reconnectTimer) {
    clearTimeout(conn.reconnectTimer);
    conn.reconnectTimer = null;
  }
  if (conn.refreshTimer) {
    clearTimeout(conn.refreshTimer);
    conn.refreshTimer = null;
  }
  conn.generation += 1;  // invalidate any in-flight callbacks
  if (conn.socket) {
    try {
      conn.socket.close(1000, 'no subscribers');
    } catch {
      /* ignore */
    }
    conn.socket = null;
  }
  conn.state = 'closed';
  conn.reconnectAttempts = 0;
  _connections.delete(projectId);
}

/**
 * Subscribe a handler for ``commit_update`` (and any other future
 * server-push event) on this project. Returns an ``unsubscribe`` fn.
 *
 * The first subscribe per project opens the underlying socket; the
 * last unsubscribe tears it down. Concurrent subscribers share one
 * socket — handlers are independently isolated.
 */
export function subscribeMutNotifications(
  projectId: string,
  handler: MutNotificationHandler,
): () => void {
  if (!projectId) {
    // Defensive: no-op subscription for un-mounted / loading state.
    return () => {};
  }

  const conn = _getOrCreate(projectId);
  conn.handlers.add(handler);

  if (conn.state === 'closed') {
    void _connect(projectId, conn);
  }

  return () => {
    conn.handlers.delete(handler);
    if (conn.handlers.size === 0) {
      _teardown(projectId, conn);
    }
  };
}

/**
 * Test / hot-reload helper — closes every active connection. Not
 * meant for app-runtime use.
 */
export function _resetAllForTests(): void {
  for (const [pid, conn] of Array.from(_connections.entries())) {
    _teardown(pid, conn);
  }
  _connections.clear();
}
