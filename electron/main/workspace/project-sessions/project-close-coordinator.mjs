/** A failure retains authority for cleanup; business admission is already shut. */
export function createProjectCloseCoordinator({ registry, operations, participants, publish, closeTimeoutMs = 10_000 }) {
  return function close(record) {
    if (record.state === "closed") return Promise.resolve({ closed: true });
    if (record.closePromise) return record.closePromise;
    record.state = "closing";
    record.failures = [];
    operations.cancel(record);
    publish(record.ownerId);
    const release = async () => {
      const results = await Promise.allSettled(participants.map((participant) => (
        withDeadline(Promise.resolve().then(() => participant.closeProject(record.ownerId, record.rootPath, record)), closeTimeoutMs)
      )));
      return results.flatMap((result, index) => result.status === "rejected" ? [participants[index].name] : []);
    };
    record.closePromise = (async () => {
      // Interrupt resources already allocated while pending starts unwind.
      const failures = await release();
      try { await operations.drain(record); } catch { failures.push("pending-operations"); }
      record.failures = [...new Set([...failures, ...await release()])];
      if (record.failures.length > 0) {
        publish(record.ownerId);
        return { closed: false, failures: [...record.failures] };
      }
      registry.finish(record);
      publish(record.ownerId);
      return { closed: true };
    })().finally(() => { record.closePromise = null; });
    return record.closePromise;
  };
}

function withDeadline(operation, timeoutMs) {
  let timer;
  return Promise.race([operation, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Project resources are still stopping.")), timeoutMs);
  })]).finally(() => clearTimeout(timer));
}
