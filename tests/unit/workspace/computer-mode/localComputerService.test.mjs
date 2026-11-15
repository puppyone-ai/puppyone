import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalComputerService } from "../../../../electron/main/local-computers/local-computer-service.mjs";
import { createLocalVncWsBridge } from "../../../../electron/main/local-computers/local-vnc-ws-bridge.mjs";

const tempDirs = [];

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "p1-computer-mode-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("localComputerService", () => {
  it("registers, wakes, sleeps, and suspends running computers when the experiment is disabled", async () => {
    const stateDir = await makeTempDir();
    const workspaceA = path.join(stateDir, "alpha");
    const workspaceB = path.join(stateDir, "beta");
    await fs.mkdir(workspaceA, { recursive: true });
    await fs.mkdir(workspaceB, { recursive: true });

    const published = [];
    const service = createLocalComputerService({
      stateDirectory: stateDir,
      limactlPathOverride: "/opt/mock/limactl",
      execCommand: vi.fn(async () => ({ stdout: "", stderr: "" })),
      publishSnapshot: (snapshot) => published.push(snapshot),
    });

    await service.setExperimentalOptIn({ enabled: true });
    const afterRegisterA = await service.register({
      workspacePath: workspaceA,
      name: "Alpha Box",
      startNow: true,
    });
    expect(afterRegisterA.experimentalEnabled).toBe(true);
    expect(afterRegisterA.runtime.available).toBe(true);
    expect(afterRegisterA.computers).toHaveLength(1);
    expect(afterRegisterA.computers[0].name).toBe("Alpha Box");
    expect(afterRegisterA.computers[0].status).toBe("running");

    const alphaId = afterRegisterA.computers[0].id;
    const screenBeforeDesktop = await service.connectScreen({ id: alphaId });
    expect(screenBeforeDesktop.transport).toBe("managed-preview");

    const afterSleep = await service.sleep({ id: alphaId });
    expect(afterSleep.computers[0].status).toBe("asleep");
    await expect(service.connectScreen({ id: alphaId })).rejects.toMatchObject({ status: 409 });

    const afterWake = await service.wake({ id: alphaId });
    expect(afterWake.computers[0].status).toBe("running");

    await service.register({
      workspacePath: workspaceB,
      name: "Beta Box",
      startNow: true,
    });

    const afterOptOut = await service.setExperimentalOptIn({ enabled: false });
    expect(afterOptOut.experimentalEnabled).toBe(false);
    expect(afterOptOut.computers.map((item) => item.status)).toEqual(["asleep", "asleep"]);
    expect(published.length).toBeGreaterThanOrEqual(5);

    await service.closeAll();
  });

  it("relays binary VNC handshake frames over the loopback WebSocket bridge", async () => {
    const bridge = createLocalVncWsBridge();
    const tcpServer = net.createServer((socket) => {
      socket.write(Buffer.from("RFB 003.008\n", "ascii"));
      socket.on("data", (chunk) => {
        socket.write(chunk);
      });
    });
    await new Promise((resolve) => tcpServer.listen(0, "127.0.0.1", resolve));
    const tcpPort = tcpServer.address().port;

    try {
      const session = await bridge.issueSession({ vncPort: tcpPort });
      expect(session.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/vnc\/[0-9a-f]+$/);

      const received = await new Promise((resolve, reject) => {
        const ws = new WebSocket(session.url, session.protocols);
        ws.binaryType = "arraybuffer";
        const chunks = [];
        ws.addEventListener("message", (event) => {
          const text = Buffer.from(event.data).toString("ascii");
          chunks.push(text);
          if (chunks.length === 1) {
            ws.send(Buffer.from("CLIENT-OK", "ascii"));
          } else if (chunks.length === 2) {
            ws.close();
            resolve(chunks);
          }
        });
        ws.addEventListener("error", reject);
      });

      expect(received).toEqual(["RFB 003.008\n", "CLIENT-OK"]);
    } finally {
      await bridge.closeAll();
      await new Promise((resolve) => tcpServer.close(resolve));
    }
  });
});
