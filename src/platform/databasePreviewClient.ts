import type { DatabaseInfo, DatabasePage, DatabasePreviewPort } from "@puppyone/shared-ui";

export type DatabaseReply<T> = { ok: true; value: T } | { ok: false; error: { code: string } };
export type DatabaseOpenRequest = { version: 1; id: string; rootPath: string; path: string };
export type DatabaseReadRequest = { version: 1; id: string; rootPath: string; objectId?: string; columnOffset?: number; cursor?: string };
export type DatabaseBridge = {
  openDatabasePreview: (request: DatabaseOpenRequest) => Promise<DatabaseReply<DatabaseInfo>>;
  readDatabasePreviewPage: (request: DatabaseReadRequest) => Promise<DatabaseReply<DatabasePage>>;
  closeDatabasePreview: (request: { id: string }) => Promise<DatabaseReply<void>>;
};
function unwrap<T>(reply: DatabaseReply<T>): T {
  if (!reply.ok) throw Object.assign(new Error(reply.error.code), { code: reply.error.code });
  return reply.value;
}
export function createDatabasePreviewPort(rootPath: string, bridge: () => DatabaseBridge): DatabasePreviewPort {
  return { async open(path, signal) {
    signal.throwIfAborted();
    const id = crypto.randomUUID();
    const api = bridge();
    let closing: Promise<void> | undefined;
    const close = () => closing ??= api.closeDatabasePreview({ id }).then(unwrap).catch((error) => { closing = undefined; throw error; });
    const cancel = () => { void close().catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    const ready = api.openDatabasePreview({ version: 1, id, rootPath, path }).then(unwrap).then(async (info) => {
      if (signal.aborted) { await close(); signal.throwIfAborted(); }
      return info;
    }).catch(async (error) => { await close(); throw error; });
    // The host lease takes ownership on the next microtask. Suppress only the
    // unhandled-rejection notification; consumers still await the same failure.
    void ready.catch(() => {});
    return {
      ready,
      async readPage(request, pageSignal) {
        pageSignal.throwIfAborted();
        pageSignal.addEventListener("abort", cancel, { once: true });
        try {
          await ready;
          pageSignal.throwIfAborted();
          const page = unwrap(await api.readDatabasePreviewPage({ ...request, version: 1, id, rootPath }));
          pageSignal.throwIfAborted(); return page;
        } finally { pageSignal.removeEventListener("abort", cancel); }
      },
      close: async () => { signal.removeEventListener("abort", cancel); await close(); },
    };
  } };
}
