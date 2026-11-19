// @vitest-environment node
import { once } from "node:events";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { expect, it } from "vitest";
import { prepareLocalCloudDevServices, resolveLocalCloudDevConfig } from "../../../../scripts/local-cloud-dev.mjs";
import { spawnManagedChild } from "../../../../scripts/managed-child-process.mjs";

// Explicit cross-repository acceptance test. Never fall back to a workstation
// service or silently skip a configured-but-missing preview build.
const frontend = process.env.PUPPYONE_TEST_CLOUD_FRONTEND;
it.skipIf(!frontend)("starts the actual standalone server, checks login once, and tears down only owned services", async () => {
  expect(path.isAbsolute(frontend)).toBe(true);
  expect(existsSync(path.join(frontend, ".next-desktop-login", "BUILD_ID"))).toBe(true);
  async function freePort() {
    const server = net.createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
  }
  const apiPort = await freePort(), webPort = await freePort();
  const config = resolveLocalCloudDevConfig({
    desktopRoot: path.resolve("."), readFile: () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
    environment: {
      PUPPYONE_LOCAL_CLOUD_MODE: "preview", PUPPYONE_CLOUD_DEV_ROOT: path.dirname(frontend),
      VITE_DESKTOP_CLOUD_API_URL: `http://127.0.0.1:${apiPort}/api/v1`,
      VITE_DESKTOP_CLOUD_WEB_URL: `http://127.0.0.1:${webPort}`,
    },
  });
  const requested = [];
  const fetchImpl = (url, options) => { requested.push(String(url)); return fetch(url, options); };
  // Only the API dependency is synthetic. This test makes no database writes
  // and is not a claim that a real authentication round-trip passed.
  const spawn = (command, args, options) => command === process.execPath && args[0] === "-m"
    ? spawnManagedChild(process.execPath, ["-e", `
      const http = require('node:http');
      const server = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({status:'ready'})); });
      server.listen(${apiPort}, '127.0.0.1');
      process.on('SIGTERM', () => server.close(() => process.exit(0)));
    `], { ...options, stdio: "ignore" })
    : spawnManagedChild(command, args, { ...options, stdio: "ignore" });
  let services;
  try {
    services = await prepareLocalCloudDevServices(config, {
      environment: { PUPPYONE_CLOUD_BACKEND_PYTHON: process.execPath }, fetchImpl,
      spawn, logger: { info: () => {} }, startupTimeoutMs: 15_000,
    });
    expect(services.ownedProcesses).toHaveLength(2);
    // Check actual browser assets, not only the HTML shell.
    const loginResponse = await fetch(config.webLoginUrl);
    const html = await loginResponse.text();
    const script = html.match(/src="([^\"]*\/_next\/[^\"]+\.js[^\"]*)"/);
    expect(script).not.toBeNull();
    expect((await fetch(new URL(script[1].replace(/&amp;/g, "&"), config.webOrigin))).status).toBe(200);
    expect((await fetch(new URL("/puppyone-logo.svg", config.webOrigin))).status).toBe(200);
    expect(requested.filter(url => new URL(url).pathname === "/login")).toHaveLength(1);
    requested.length = 0;
    expect(await services.probeAll()).toEqual([{ name: "API", ready: true }, { name: "login web app", ready: true }]);
    expect(requested.map(url => new URL(url).pathname)).toEqual(["/health", "/api/health"]);
    const reused = await prepareLocalCloudDevServices(config, {
      environment: { PUPPYONE_CLOUD_BACKEND_PYTHON: process.execPath }, fetchImpl,
      spawn: () => { throw new Error("Must not spawn duplicate services"); }, logger: { info: () => {} },
    });
    expect(reused.ownedProcesses).toEqual([]);
    await reused.stop();
    expect((await services.probeAll()).every(item => item.ready)).toBe(true);
    await services.stop();
    for (const port of [apiPort, webPort]) {
      const server = net.createServer(); server.listen(port, "127.0.0.1");
      await once(server, "listening");
      await new Promise(resolve => server.close(resolve));
    }
  } finally { await services?.stop(); }
}, 30_000);
