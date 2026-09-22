/** A Main-owned management surface survives removal or failure of every Chat/PTY view. */
export function createItemLifecycleManager({ lifecycle, dialog, t }) {
  const open = new Map();
  async function present(ownerId) {
    let page = 0;
    for (;;) {
      const entries = lifecycle.list(record => record.ownerId === ownerId && record.cleanup !== "confirmed");
      const visible = entries.slice(page * 6, page * 6 + 6);
      if (!visible.length && page > 0) { page = 0; continue; }
      const buttons = visible.map(entry => `${entry.kind} · ${entry.itemId.slice(0, 12)}`);
      const next = buttons.length;
      if (entries.length > 6) buttons.push(t("native.execution.next"));
      const cancelId = buttons.length;
      buttons.push(t("native.execution.done"));
      const selection = await dialog.showMessageBox({ type: "info", title: t("native.execution.title"),
        message: t("native.execution.title"), detail: entries.length ? t("native.execution.inventory") : t("native.execution.empty"),
        buttons, cancelId, defaultId: cancelId, noLink: true });
      if (selection.response === cancelId) return;
      if (selection.response === next) { page = (page + 1) * 6 < entries.length ? page + 1 : 0; continue; }
      const entry = visible[selection.response];
      if (!entry) return;
      const retry = entry.desiredLifecycle === "terminated";
      const result = await dialog.showMessageBox({ type: "warning", title: t("native.execution.title"),
        message: `${entry.kind} · ${entry.itemId.slice(0, 12)}`,
        detail: `${t(`native.execution.state.${entry.cleanup}`)}\n${t("native.execution.consequence")}`,
        buttons: [t(retry ? "native.execution.retry" : "native.execution.terminate"), t("native.execution.refresh"), t("native.execution.done")],
        defaultId: 2, cancelId: 2, noLink: true });
      if (result.response === 2) return;
      if (result.response === 0) lifecycle.terminate({ ...entry, ownerId, root: entry.projectContext.rootPath },
        entry.operationId ?? `terminate-${entry.executionId}`, { retry });
    }
  }
  return function manage(ownerId) {
    if (open.has(ownerId)) return open.get(ownerId);
    const pending = present(ownerId).finally(() => open.delete(ownerId));
    open.set(ownerId, pending);
    return pending;
  };
}
