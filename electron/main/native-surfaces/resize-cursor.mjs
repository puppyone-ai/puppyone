/** A native child owns its own CSS cursor. Use a removable author stylesheet so
 * content-specific cursors survive the gesture, including async IPC races. */
export function createNativeSurfaceResizeCursor(contents, onError = () => {}) {
  let desired = null;
  let key = null;
  let generation = 0;
  let disposed = false;
  const remove = async (stylesheet) => {
    if (!stylesheet || contents.isDestroyed?.()) return;
    try { await contents.removeInsertedCSS?.(stylesheet); } catch (error) { onError(error); }
  };
  async function set(cursor) {
    if (disposed || cursor === desired) return;
    desired = cursor;
    const revision = ++generation;
    const previous = key;
    key = null;
    await remove(previous);
    if (disposed || revision !== generation || !cursor || !contents.insertCSS) return;
    try {
      // Electron's removal API does not remove user-origin sheets on the
      // supported runtime. Keep this temporary override in the author origin.
      const inserted = await contents.insertCSS(`:root, :root * { cursor: ${cursor} !important; }`, { cssOrigin: "author" });
      if (disposed || revision !== generation) await remove(inserted);
      else key = inserted;
    } catch (error) { onError(error); }
  }
  return {
    set(cursor) {
      if (cursor !== null && cursor !== "col-resize" && cursor !== "row-resize") return;
      void set(cursor);
    },
    dispose() {
      disposed = true;
      generation += 1;
      void remove(key);
      key = null;
    },
  };
}
