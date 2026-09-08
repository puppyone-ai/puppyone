import { projectSessionError } from "../../../../shared/project-session-contract/schema.mjs";

/** Pending admission is registered before any asynchronous prerequisite. */
export class ProjectOperationRegistry {
  operations = new Map();

  run(record, action) {
    if (record.state !== "open") throw projectSessionError("PROJECT_CLOSING", "This project is closing.");
    const controller = new AbortController();
    const entry = { controller, promise: null };
    let entries = this.operations.get(record);
    if (!entries) this.operations.set(record, entries = new Set());
    entries.add(entry);
    const assertCurrent = () => {
      if (record.state !== "open" || controller.signal.aborted) throw projectSessionError("PROJECT_STALE", "This operation belongs to a project that has closed.");
    };
    entry.promise = Promise.resolve().then(() => {
      assertCurrent();
      return action({ signal: controller.signal, assertCurrent, context: record });
    }).then((value) => { assertCurrent(); return value; }).finally(() => {
      entries.delete(entry);
      if (entries.size === 0) this.operations.delete(record);
    });
    return entry.promise;
  }

  cancel(record) { for (const entry of this.operations.get(record) ?? []) entry.controller.abort(); }
  async drain(record, timeoutMs = 10_000) {
    let timer;
    try {
      await Promise.race([
        Promise.allSettled([...(this.operations.get(record) ?? [])].map((entry) => entry.promise)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Project preparation is still stopping.")), timeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
  }
}
