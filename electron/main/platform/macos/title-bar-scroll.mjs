import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

let nativeModule = null;

export function loadMacosTitleBarScroll() {
  // electron-builder unpacks .node files; loaded on first use, never at startup.
  nativeModule ??= createRequire(import.meta.url)(
    fileURLToPath(new URL("./native/title-bar-scroll.node", import.meta.url)),
  );
  return nativeModule;
}

/**
 * Lets scrolling over the title bar a window's page draws reach the page under
 * it. The bar stays a native drag region, so pressing there still moves the
 * window and a double-click still zooms it.
 */
export function passTitleBarScrollToPage(window) {
  return loadMacosTitleBarScroll().passTitleBarScrollToPage(window.getNativeWindowHandle());
}
