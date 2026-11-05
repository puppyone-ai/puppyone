import { describe, expect, it } from "vitest";
import { registerHostIpcHandlers } from "../../../../electron/main/ipc/host-ipc.mjs";

describe("host IPC", () => {
  it("requires an admitted local root and explicit approval before registration", async () => {
    const handlers = new Map();
    const ipcMain = { handle: (name, fn) => handlers.set(name, fn) };
    let promptCount = 0;
    const host = registerHostIpcHandlers({ ipcMain, app: { getPath: () => "/unused" },
      auth: { readSession: async () => ({ user_id: "a", session_generation: "one",
        api_base_url: "https://api.puppyone.ai/api/v1" }),
        requestSessionApi: async () => { throw new Error("must not contact cloud"); } },
      apiBase: "https://api.puppyone.ai/api/v1", authorizeWorkspaceRoot: async (_event, root) => {
        if (root !== "/authorized") throw new Error("Unauthorized root");
        return root;
      }, dialog: { showMessageBox: async () => { promptCount++; return { response: 0 }; } },
      BrowserWindow: { fromWebContents: () => ({}) }, t: (id) => id });
    const event = { sender: {} };
    await expect(handlers.get("host:register-folder")(event, { rootPath: "/etc" })).rejects.toThrow("Unauthorized root");
    expect(promptCount).toBe(0);
    expect(await handlers.get("host:register-folder")(event, { rootPath: "/authorized" })).toEqual({ cancelled: true });
    expect(promptCount).toBe(1);
    host.dispose();
  });
});
