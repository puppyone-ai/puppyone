export const WORKBENCH_TAB_MOVE_PREVIEW_CLASS = "desktop-terminal-tab-move-preview";

export function createWorkbenchTabMovePreview(
  source: HTMLElement,
  label: string,
  clientX: number,
  clientY: number,
): HTMLElement {
  const doc = source.ownerDocument;
  const preview = doc.createElement("div");
  preview.className = WORKBENCH_TAB_MOVE_PREVIEW_CLASS;
  preview.setAttribute("aria-hidden", "true");
  preview.textContent = label;
  const overlayRoot = doc.getElementById("desktop-overlay-root");
  (overlayRoot instanceof HTMLElement ? overlayRoot : doc.body).append(preview);
  moveWorkbenchTabMovePreview(preview, clientX, clientY);
  return preview;
}

export function moveWorkbenchTabMovePreview(
  preview: HTMLElement,
  clientX: number,
  clientY: number,
): void {
  preview.style.transform = `translate3d(${clientX}px, ${clientY}px, 0) translate(-18px, 12px)`;
}

export function destroyWorkbenchTabMovePreview(preview: HTMLElement | null | undefined): void {
  preview?.remove();
}
