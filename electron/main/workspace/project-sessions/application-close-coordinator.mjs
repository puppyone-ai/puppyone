/** Windows save documents and close projects first; shared runtimes drain last. */
export function createApplicationCloseCoordinator({ app, getWindows, closeResources, onFailure, logger = console }) {
  let drained = false;
  let draining = null;
  return function beforeQuit(event) {
    if (getWindows().length || drained) return;
    event.preventDefault();
    if (draining) return;
    draining = Promise.resolve().then(closeResources).then(() => {
      drained = true;
      app.quit();
    }).catch(async (error) => {
      logger.error("Unable to stop application resources:", error);
      // A failed drain stays retryable. Never spin an automatic quit loop.
      await onFailure?.(error);
    }).finally(() => { draining = null; });
  };
}
