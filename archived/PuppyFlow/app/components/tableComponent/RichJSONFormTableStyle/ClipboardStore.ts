export type ClipboardPayload = any;

let internalClipboard: ClipboardPayload | null = null;

export function setClipboard(payload: ClipboardPayload | null) {
  internalClipboard = payload;
}

export function getClipboard(): ClipboardPayload | null {
  return internalClipboard;
}
