#!/usr/bin/env electron
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, utilityProcess, MessageChannelMain } from "electron";
import { createTerminalProcessService } from "../electron/main/item-hosts/terminal-process-service.mjs";
import { createItemHostBudget } from "../electron/main/item-hosts/resource-budget.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-item-utility-smoke-"));
app.setPath("userData", path.join(fixture, "profile"));
// Test-only process environment: never load the user's interactive shell files.
process.env.HOME = fixture;
process.env.SHELL = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
process.env.ZDOTDIR = fixture;
delete process.env.ELECTRON_RUN_AS_NODE;
const budget = createItemHostBudget();
const events = [];
const owner = { id: 1, isDestroyed: () => false, send() {} };
const ports = [];
const service = createTerminalProcessService({ utilityProcess,
  modulePath: path.join(root, "electron", "utility", "terminal", "main.mjs"), budget,
  appVersion: "smoke", initializeWorkspaceEditReview: async () => {}, terminalAgentActivityHost: null,
  onHostEvent: (record, event) => events.push({ id: record.id, ...event }),
});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 12_000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error(`Timed out: ${label}`); await wait(20); }
}
async function attach(receipt, connection) {
  const { port1, port2 } = new MessageChannelMain();
  const display = { text: "", frames: 0, connection, port: port2 };
  ports.push(port2);
  port2.on("message", ({ data }) => {
    assert.equal(data.connection, connection);
    display.frames += 1;
    for (const entry of data.entries) {
      if (entry.reset) display.text = "";
      display.text += entry.data ?? "";
    }
    port2.postMessage({ type: "terminal-ack", connection, sequence: data.sequence });
  });
  port2.start();
  await service.attachDisplay(owner, receipt, port1, { connection });
  return display;
}
const print = (receipt, text) => service.input(owner, { ...receipt, data: `printf '${text}\\n'\r` });

const watchdog = setTimeout(() => { console.error("Item utility smoke exceeded its deadline."); app.exit(1); }, 90_000);
async function run() {
app.dock?.hide();
let failed = false;
try {
  const first = await service.create(owner, { id: "fixture-a", launcherId: "shell", cwd: fixture, cols: 80, rows: 24 }, fixture);
  const second = await service.create(owner, { id: "fixture-b", launcherId: "shell", cwd: fixture, cols: 80, rows: 24 }, fixture);
  const pids = service.diagnostics().map((entry) => entry.pid);
  assert.equal(new Set([process.pid, ...pids, first.pid, second.pid]).size, 5, "Execution and PTY processes must be independent.");
  const a = await attach(first, "display-a1");
  const b = await attach(second, "display-b1");
  service.input(owner, { ...first, data: "stty -echo\r" });
  service.input(owner, { ...second, data: "stty -echo\r" });
  await wait(100);
  print(first, "first-ready"); print(second, "second-ready");
  await until(() => a.text.includes("first-ready") && b.text.includes("second-ready"), "initial output");
  a.port.close();
  print(first, "retained-while-detached");
  await wait(100);
  const recovered = await attach(first, "display-a2");
  await until(() => recovered.text.includes("retained-while-detached"), "headless checkpoint recovery");
  assert.equal(service.getDisplayReceipt(owner, first).pid, first.pid, "Display recovery respawned the PTY.");
  process.kill(pids[0], "SIGKILL");
  await until(() => events.some((event) => event.id === first.id && event.type === "host-exited"), "utility crash supervision");
  print(second, "sibling-still-live");
  await until(() => b.text.includes("sibling-still-live"), "sibling survives utility crash");
  await service.closeAll();
  assert.equal(budget.snapshot().length, 0, "Exited hosts retained resource leases.");
  console.log(JSON.stringify({ ok: true, mainPid: process.pid, utilityPids: pids, ptyPids: [first.pid, second.pid],
    recoveredWithoutRespawn: true, crashContained: true, resourceLeases: budget.snapshot().length }, null, 2));
} catch (error) {
  failed = true;
  console.error(error);
  console.error(JSON.stringify({ diagnostics: service.diagnostics(), events }, null, 2));
} finally {
  ports.forEach((port) => port.close());
  await service.closeAll().catch((error) => { failed = true; console.error(error); });
  await fs.rm(fixture, { recursive: true, force: true });
  clearTimeout(watchdog);
  app.exit(failed ? 1 : 0);
}
}

app.whenReady().then(run).catch((error) => { console.error(error); clearTimeout(watchdog); app.exit(1); });
