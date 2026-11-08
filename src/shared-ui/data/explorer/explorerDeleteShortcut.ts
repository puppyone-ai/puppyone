/**
 * Delete keys the Explorer itself owns. The host decides whether the macOS
 * combination exists; this module never reads the platform.
 */
export type ExplorerDeleteKeyEvent = Readonly<{
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  defaultPrevented: boolean;
}>;

export function isExplorerDeleteShortcut(
  event: ExplorerDeleteKeyEvent,
  deleteWithMetaBackspace: boolean,
): boolean {
  if (event.defaultPrevented || event.repeat || event.isComposing) return false;
  if (event.ctrlKey || event.altKey || event.shiftKey) return false;
  // macOS keycaps say Delete on the Backspace key, so the chord is explicit.
  if (event.key === "Delete") return !event.metaKey;
  return deleteWithMetaBackspace && event.key === "Backspace" && event.metaKey;
}
