/**
 * The user-facing part of an error that crossed Electron IPC. Electron wraps a
 * main-process rejection as "Error invoking remote method '<channel>': Error:
 * <message>"; the channel and the nested Error prefix are transport detail.
 */
export function ipcErrorMessage(message: string): string {
  return message
    .replace(/Error invoking remote method '[^']*':\s*/gi, "")
    .replace(/Error invoking remote method[^:]*:\s*/gi, "")
    .replace(/^(?:[A-Z]\w*Error|Error):\s*/, "")
    .trim();
}
