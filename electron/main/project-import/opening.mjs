/** Keeps one completed import per window while opening it is being retried. */
export function createImportOpeningRecovery({ remember, open }) {
  const pending = new WeakMap();
  return Object.freeze({
    get(sender, taskId) {
      const record = pending.get(sender);
      return record?.taskId === taskId ? record.project : null;
    },
    async open(sender, taskId, project) {
      pending.set(sender, { taskId, project });
      try {
        await remember(project.path);
        const result = await open(sender, project.path);
        pending.delete(sender);
        return { project, opening: { status: "opened", result } };
      } catch (error) {
        return { project, opening: { status: "failed", message: error instanceof Error ? error.message : String(error) } };
      }
    },
  });
}
