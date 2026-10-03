// @vitest-environment node
import { once } from "node:events";
import net from "node:net";
import { expect, it } from "vitest";
import { spawnManagedChild } from "../../../../scripts/managed-child-process.mjs";
import { stopOwnedChild } from "../../../../scripts/managed-child-lifecycle.mjs";

it.skipIf(process.platform === "win32")("stops a real server grandchild after its wrapper exits, without touching a reused server", async () => {
  const unrelated = net.createServer();
  unrelated.listen(0, "127.0.0.1");
  await once(unrelated, "listening");
  const grandchildCode = `
    const net = require('node:net');
    process.on('SIGTERM', () => {});
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => process.send({ pid: process.pid, port: server.address().port }));
  `;
  const wrapperCode = `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildCode)}], { stdio: ['ignore','ignore','ignore','ipc'] });
    child.on('message', message => process.send(message));
    process.on('SIGTERM', () => process.exit(0));
  `;
  const child = spawnManagedChild(process.execPath, ["-e", wrapperCode], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  try {
    const [server] = await once(child, "message", { signal: AbortSignal.timeout(5_000) });
    expect(Number.isInteger(server.port)).toBe(true);
    await stopOwnedChild(child, { graceMs: 150, killWaitMs: 3_000 });
    const portProbe = net.createServer();
    portProbe.listen(server.port, "127.0.0.1");
    await once(portProbe, "listening");
    await new Promise(resolve => portProbe.close(resolve));
    expect(unrelated.listening).toBe(true);
  } finally {
    await stopOwnedChild(child, { graceMs: 0 }).catch(() => {});
    await new Promise(resolve => unrelated.close(resolve));
  }
}, 10_000);
