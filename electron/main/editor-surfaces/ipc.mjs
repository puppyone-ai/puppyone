export const EDITOR_SURFACE_CHANNELS = Object.freeze({
  activate: "editor-surface:activate",
  setBounds: "editor-surface:set-bounds",
  updateAppearance: "editor-surface:update-appearance",
  destroy: "editor-surface:destroy",
  state: "editor-surface:state",
});

export function registerEditorSurfaceIpcHandlers({
  trustedIpcMain,
  manager,
}) {
  trustedIpcMain.handle(EDITOR_SURFACE_CHANNELS.activate, (event, request) => (
    manager.activate({ ...request, ownerWebContentsId: event.sender.id })
  ));
  trustedIpcMain.handle(EDITOR_SURFACE_CHANNELS.setBounds, (event, request) => (
    manager.setBounds(
      request?.sessionId,
      request?.bounds,
      event.sender.id,
      request?.geometryRevision,
      request?.visible,
    )
  ));
  trustedIpcMain.handle(EDITOR_SURFACE_CHANNELS.updateAppearance, (event, request) => (
    manager.updateAppearance(request?.sessionId, request?.appearance, event.sender.id)
  ));
  trustedIpcMain.handle(EDITOR_SURFACE_CHANNELS.destroy, (event, request) => (
    manager.destroy(request?.sessionId, event.sender.id)
  ));
}
