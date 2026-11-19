import type { DatabaseInfo, DatabasePage, DatabasePreviewPort, DatabasePreviewSession } from "../../preview-services/types";
import { acquireEditorHostLease } from "../../runtime/EditorHostLeases";
import type { EditorTaskOwner } from "../../runtime/EditorTaskScheduler";

type Lease = ReturnType<typeof acquireEditorHostLease<DatabasePreviewSession>>;
type Connection = { lease: Lease; ready: Promise<{ session: DatabasePreviewSession; info: DatabaseInfo }>; expiresAt: number };
type ReadRequest = { objectName: string; columnOffset?: number; cursor?: string | null; snapshotEpoch?: string };

/** Attachment-local native lifecycle. A connection may sleep independently of
 * the bounded page retained by the DOM viewer. Never replay across snapshots. */
export function createDatabasePreviewReader(port: DatabasePreviewPort, path: string, owner: EditorTaskOwner, signal: AbortSignal) {
  let current: Connection | null = null;
  let retiring: Lease | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let reading = false;

  const assertActive = () => {
    signal.throwIfAborted();
    if (closed) throw new DOMException("Database reader closed", "AbortError");
  };
  const clearTimer = () => { clearTimeout(timer); timer = undefined; };
  const suspend = async () => {
    clearTimer();
    if (current) { retiring = current.lease; current = null; }
    const lease = retiring;
    // Retain failed close handles: the next interaction retries the common
    // exit barrier, rather than allocating overlapping native hosts.
    await lease?.close();
    if (retiring === lease) retiring = null;
  };
  const arm = (connection: Connection, expiresAt: number) => {
    clearTimer(); connection.expiresAt = expiresAt;
    timer = setTimeout(() => {
      if (current === connection) void suspend().catch(() => {});
    }, Math.max(0, expiresAt - Date.now()));
  };
  const connect = async () => {
    assertActive();
    if (current && current.expiresAt <= Date.now()) await suspend();
    if (retiring) await suspend();
    assertActive();
    if (!current) {
      const lease = acquireEditorHostLease(owner, async (hostSignal) => {
        const session = await port.open(path, hostSignal);
        return { value: session, release: session.close };
      }, signal);
      const connection: Connection = { lease, expiresAt: Infinity, ready: lease.ready.then(async (session) => {
        const info = await session.ready;
        assertActive();
        if (current !== connection) throw new DOMException("Database connection retired", "AbortError");
        arm(connection, info.expiresAt);
        return { session, info };
      }) };
      current = connection;
    }
    return current.ready;
  };
  const close = async () => {
    closed = true;
    signal.removeEventListener("abort", cancel);
    await suspend();
  };
  const cancel = () => { void close().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });

  return {
    async open() {
      try { return (await connect()).info; }
      catch (error) { await suspend(); throw error; }
    },
    async read(request: ReadRequest): Promise<{ info: DatabaseInfo; page: DatabasePage; objectId: string; continued: boolean }> {
      assertActive();
      if (reading) throw new Error("busy");
      reading = true;
      clearTimer();
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            const { session, info } = await connect();
            assertActive();
            // Queries have their own native watchdog. Do not let the previous
            // idle deadline abort a query that has already renewed its lease.
            clearTimer();
            const connection = current!;
            const object = info.objects.find((entry) => entry.name === request.objectName && entry.readable);
            if (!object) throw new Error("unsupported-object");
            const continued = Boolean(request.cursor && request.snapshotEpoch === info.snapshotEpoch);
            const page = await session.readPage(continued ? { cursor: request.cursor! }
              : { objectId: object.id, columnOffset: request.columnOffset ?? 0 }, signal);
            assertActive();
            if (current !== connection) throw new DOMException("Database connection retired", "AbortError");
            arm(connection, page.expiresAt);
            return { info, page, objectId: object.id, continued };
          } catch (error) {
            await suspend();
            assertActive();
            // Only an unavailable session is recoverable automatically. Input,
            // permission, cursor, timeout and native failures remain failures.
            if (attempt !== 0 || !(error instanceof Error) || error.message !== "session-expired") throw error;
          }
        }
      } finally { reading = false; }
    },
    close,
  };
}

export type DatabasePreviewReader = ReturnType<typeof createDatabasePreviewReader>;
