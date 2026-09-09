/** Shared native view geometry/occlusion ownership, independent of content kind. */
export function attachNativeSurfaceView({ window, view, nativeSurfaceOcclusion, nativeSurfacePointerPassthrough }) {
  let visible = false;
  let healthy = true;
  let occluded = false;
  let disposed = false;
  let revision = -1;
  const apply = () => {
    if (disposed || view.webContents.isDestroyed()) return;
    view.setVisible(visible && healthy && !occluded && window.isVisible());
  };
  const releaseOcclusion = nativeSurfaceOcclusion?.register({ ownerWebContentsId: window.webContents.id,
    setOccluded(value) { occluded = value; apply(); } });
  const releasePointer = nativeSurfacePointerPassthrough?.register({ ownerWebContentsId: window.webContents.id,
    ownerWebContents: window.webContents, surfaceView: view });
  window.on("show", apply);
  window.on("hide", apply);
  view.setVisible(false);
  window.contentView.addChildView(view);
  return {
    geometry(request) {
      if (disposed || !Number.isSafeInteger(request.revision) || request.revision <= revision) return;
      const bounds = request.bounds;
      if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) throw new Error("Invalid native surface bounds.");
      const [width, height] = window.getContentSize();
      const x = Math.max(0, Math.min(width, Math.round(bounds.x)));
      const y = Math.max(0, Math.min(height, Math.round(bounds.y)));
      revision = request.revision;
      visible = request.visible === true && bounds.width > 0 && bounds.height > 0;
      view.setBounds({ x, y, width: Math.max(1, Math.min(width - x, Math.round(bounds.width))),
        height: Math.max(1, Math.min(height - y, Math.round(bounds.height))) });
      apply();
    },
    healthy(value) { healthy = value; apply(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeListener("show", apply);
      window.removeListener("hide", apply);
      releaseOcclusion?.(); releasePointer?.();
      try { view.setVisible(false); window.contentView.removeChildView(view); } catch { /* Owner may have closed. */ }
    },
  };
}
