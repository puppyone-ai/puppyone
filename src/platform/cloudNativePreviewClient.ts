import type { DatabaseInfo, DatabasePage, DatabasePageRequest, DatabasePreviewPort, OfficeDocumentConverter } from "@puppyone/shared-ui";
import type { DatabaseReply } from "./databasePreviewClient";

export type CloudPreviewSource = {
  apiBaseUrl: string; projectId: string; path: string;
  expectedSession: { userId: string; generation: string };
};
export type CloudNativePreviewBridge = {
  openCloudDatabasePreview: (request: CloudPreviewSource & { id: string }) => Promise<DatabaseReply<DatabaseInfo>>;
  readCloudDatabasePreviewPage: (request: DatabasePageRequest & { id: string }) => Promise<DatabaseReply<DatabasePage>>;
  closeCloudNativePreview: (request: { id: string }) => Promise<void>;
  convertCloudOfficeDocument: (request: CloudPreviewSource & { id: string }) => Promise<DatabaseReply<{ bytes: Uint8Array; warnings?: string[] }>>;
};
function unwrap<T>(reply: DatabaseReply<T>): T {
  if (!reply.ok) throw Object.assign(new Error(reply.error.code), { code: reply.error.code });
  return reply.value;
}
function operation(api: CloudNativePreviewBridge, signal: AbortSignal) {
  signal.throwIfAborted();
  const id = crypto.randomUUID();
  let closing: Promise<void> | undefined;
  const close = () => closing ??= api.closeCloudNativePreview({ id }).catch((error) => { closing = undefined; throw error; });
  const cancel = () => { void close().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  return { id, cancel, close: async () => { signal.removeEventListener("abort", cancel); await close(); } };
}

/** Cloud carries authenticated resource identity; the renderer never supplies
 * a native root or decoder filename. Sessions use the common close barrier. */
export function createCloudNativePreviewPorts(api: CloudNativePreviewBridge,
  source: (path: string) => CloudPreviewSource, assertCurrent: () => void): {
    database: DatabasePreviewPort; convertOfficeDocumentToDocx: OfficeDocumentConverter;
  } {
  return {
    database: { async open(path, signal) {
      assertCurrent();
      const remote = source(path);
      const op = operation(api, signal);
      const ready = api.openCloudDatabasePreview({ ...remote, id: op.id }).then(unwrap).then((info) => {
        assertCurrent(); signal.throwIfAborted(); return info;
      }).catch(async (error) => { await op.close(); throw error; });
      void ready.catch(() => {});
      return { ready, close: op.close, async readPage(request, pageSignal) {
        pageSignal.throwIfAborted();
        pageSignal.addEventListener("abort", op.cancel, { once: true });
        try {
          await ready; assertCurrent(); pageSignal.throwIfAborted();
          const page = unwrap(await api.readCloudDatabasePreviewPage({ ...request, id: op.id }));
          assertCurrent(); pageSignal.throwIfAborted(); return page;
        } finally { pageSignal.removeEventListener("abort", op.cancel); }
      } };
    } },
    async convertOfficeDocumentToDocx(path, options) {
      assertCurrent();
      const remote = source(path);
      const signal = options?.signal ?? new AbortController().signal;
      const op = operation(api, signal);
      try {
        const result = unwrap(await api.convertCloudOfficeDocument({ ...remote, id: op.id }));
        assertCurrent(); signal.throwIfAborted();
        return { arrayBuffer: new Uint8Array(result.bytes).buffer, warnings: result.warnings };
      } finally { await op.close(); }
    },
  };
}
