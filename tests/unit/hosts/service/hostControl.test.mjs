import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { connectControlClient, hostControlPaths, startControlServer } from "../../../../electron/host-service/control.mjs";
import { isHostServiceRoute } from "../../../../electron/host-service/service.mjs";
import { hostServiceCommand } from "../../../../electron/host-service/launcher.mjs";

const cleanup = [];
afterEach(async () => { for (const step of cleanup.splice(0).reverse()) await step(); });

async function server(handlersFor) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-host-control-")));
  const stateDir = path.join(root, "host-service");
  const control = await startControlServer({ stateDir, handlersFor, logger: { warn() {} } });
  cleanup.push(() => fs.rm(root, { recursive: true, force: true }), () => control.close());
  return { stateDir, control };
}

describe("host service control channel", () => {
  it("serves only a client that presents the token, in a directory only this user can read", async () => {
    const { stateDir } = await server(() => ({ ping: async () => "pong" }));
    const { socketPath, tokenPath } = hostControlPaths(stateDir);
    expect((await fs.stat(stateDir)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(tokenPath)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(socketPath)).mode & 0o777).toBe(0o600);

    const forged = net.createConnection(socketPath);
    const closed = new Promise((resolve) => forged.on("close", resolve));
    forged.write(`${JSON.stringify({ type: "hello", token: "not-the-token", role: "desktop" })}\n`);
    forged.write(`${JSON.stringify({ type: "call", id: "1", method: "ping" })}\n`);
    let answered = "";
    forged.on("data", (chunk) => { answered += chunk; });
    await closed;
    expect(answered).toBe("");

    const client = await connectControlClient({ stateDir });
    cleanup.push(async () => client.close());
    expect(await client.call("ping")).toBe("pong");
    await expect(client.call("unknown")).rejects.toThrow("Unknown method");
  });

  it("calls in both directions and carries error status and code", async () => {
    let desktop = null;
    const { stateDir, control } = await server((role, self) => ({
      whoami: async () => role,
      askDesktop: async () => desktop.call("session"),
      fail: async () => { throw Object.assign(new Error("refused"), { status: 403, code: "device_revoked" }); },
    }));
    const client = await connectControlClient({ stateDir, handlers: { session: async () => ({ user_id: "a" }) },
      onEvent: (event, data) => events.push([event, data]) });
    cleanup.push(async () => client.close());
    const events = [];
    [desktop] = control.peers();
    expect(await client.call("whoami")).toBe("desktop");
    expect(await client.call("askDesktop")).toEqual({ user_id: "a" });
    await expect(client.call("fail")).rejects.toMatchObject({ message: "refused", status: 403, code: "device_revoked" });
    control.broadcast("status", { state: "online" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual([["status", { state: "online" }]]);
  });

  it("lets the host service ask only for host device and folder routes", () => {
    const device = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const folder = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    for (const route of ["/hosts/devices", `/hosts/devices/${device}`, `/hosts/devices/${device}/folders`,
      `/hosts/devices/${device}/folders/${folder}`]) expect(isHostServiceRoute(route)).toBe(true);
    for (const route of ["/hosts", "/ai/balance", `/hosts/devices/${device}/challenge`, "/hosts/devices/../ai",
      `/hosts/folders/${folder}/files`, `/hosts/devices/${device}/folders/${folder}?x=1`, null]) {
      expect(isHostServiceRoute(route)).toBe(false);
    }
  });

  it("starts the host service from this installation's own program", () => {
    expect(hostServiceCommand({ execPath: "/Applications/PuppyOne.app/Contents/MacOS/PuppyOne", appPath: "/unused",
      isPackaged: true })).toEqual({ command: "/Applications/PuppyOne.app/Contents/MacOS/PuppyOne", args: ["--puppyone-host"] });
    expect(hostServiceCommand({ execPath: "/repo/node_modules/electron/dist/Electron", appPath: "/repo", isPackaged: false }))
      .toEqual({ command: "/repo/node_modules/electron/dist/Electron", args: ["/repo", "--puppyone-host"] });
  });
});
