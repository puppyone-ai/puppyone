/**
 * Joins process-local replay events with a durable metadata-only native-session
 * catalog. The event cache wins while the process is alive; the catalog is the
 * restart boundary and never receives transcript payloads.
 */
export function createAgentSessionRepository({ eventCache, conversationCatalog }) {
  if (!eventCache?.save || !conversationCatalog?.save) {
    throw new TypeError("Agent session repository requires an event cache and conversation catalog.");
  }
  return {
    historyCatalog: Object.freeze({
      list: (...args) => conversationCatalog.list(...args),
      getRevision: () => conversationCatalog.getRevision(),
      getCoverage: () => conversationCatalog.getCoverage(),
      applyNativePage: (page) => conversationCatalog.applyNativePage(page),
    }),
    async save(record, { promoteCatalog = true } = {}) {
      await Promise.all([
        eventCache.save(record),
        ...(promoteCatalog ? [conversationCatalog.save({ ...record, availability: "available" })] : []),
      ]);
    },
    upsertNative(record) {
      return conversationCatalog.upsertNative(record);
    },
    reconcileNative: (scope) => conversationCatalog.reconcileNative(scope),
    markUnavailable: (sessionId, unavailableAt) => conversationCatalog.markUnavailable(sessionId, unavailableAt),
    async findById(sessionId, workspaceRoot = null) {
      const [liveRecord, catalogRecord] = await Promise.all([
        eventCache.findById(sessionId, workspaceRoot),
        conversationCatalog.findById(sessionId, workspaceRoot),
      ]);
      if (!liveRecord) return catalogRecord;
      if (!catalogRecord) return liveRecord;
      return {
        ...catalogRecord,
        ...liveRecord,
        // Availability belongs to the durable catalog. The process-local
        // replay cache deliberately does not model History lifecycle state.
        availability: catalogRecord.availability,
      };
    },
    async findLatest(workspaceRoot, runtimeId = null) {
      return await eventCache.findLatest(workspaceRoot, runtimeId)
        ?? conversationCatalog.findLatest(workspaceRoot, runtimeId);
    },
    list(workspaceRoot, options = {}) {
      return conversationCatalog.list(workspaceRoot, options);
    },
    async archive(sessionId, archivedAt) {
      await Promise.all([
        eventCache.archive(sessionId, archivedAt),
        conversationCatalog.archive(sessionId, archivedAt),
      ]);
    },
    async remove(sessionId) {
      await Promise.all([eventCache.remove(sessionId), conversationCatalog.remove(sessionId)]);
    },
    readAll: () => eventCache.readAll(),
    clear: () => eventCache.clear?.(),
  };
}
