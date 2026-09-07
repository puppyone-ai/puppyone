/** Serialize presentation changes per window; native close fences queued work. */
export function createWindowWorkspaceOperationQueue({ assertOpen = () => undefined } = {}) {
  const pending = new Map();
  return Object.freeze({
    run(ownerId, action) {
      const previous = pending.get(ownerId) ?? Promise.resolve();
      const result = previous.catch(() => undefined).then(() => {
        assertOpen(ownerId);
        return action(() => assertOpen(ownerId));
      });
      pending.set(ownerId, result);
      void result.finally(() => {
        if (pending.get(ownerId) === result) pending.delete(ownerId);
      }).catch(() => undefined);
      return result;
    },
  });
}
