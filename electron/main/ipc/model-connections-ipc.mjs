import { parseConnectionCommand } from "../../../shared/model-connections/schema.mjs";
import { knownErrorCode } from "../model-connections/connection-service.mjs";

/** Register only on the application's trusted-frame IPC facade, never on raw ipcMain. */
export function registerModelConnectionsIpcHandlers({ ipcMain, connections }) {
  for (const command of ["read", "save", "remove", "refresh", "discover", "verify", "managed"]) {
    ipcMain.handle(`model-connections:${command}`, async (_event, raw) => {
      try {
        const request = parseConnectionCommand(command, raw);
        return { ok: true, value: await connections[command](request) };
      } catch (error) {
        // Never serialize native errors; a remote provider may echo Authorization.
        return { ok: false, code: knownErrorCode(error) };
      }
    });
  }
}
