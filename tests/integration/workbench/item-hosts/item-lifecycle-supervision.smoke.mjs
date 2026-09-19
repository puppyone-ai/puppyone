import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { app, utilityProcess } from "electron";
import { createUtilityHost } from "../../../../electron/main/item-hosts/utility-host.mjs";
import { createItemHostBudget } from "../../../../electron/main/item-hosts/resource-budget.mjs";
import { createItemLifecycleSupervisor } from "../../../../electron/main/item-hosts/item-lifecycle-supervisor.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-lifecycle-supervision-"));
app.setPath("userData", path.join(temporary, "profile"));
const hosts = [];
const lifecycle = createItemLifecycleSupervisor();
const budget = createItemHostBudget({ closeTimeoutMs: 6000 });
const projectContext = { projectId: "fixture", generation: "fixture-generation", rootPath: temporary };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, label) {
  const deadline = performance.now() + 8000;
  while (!test()) { if (performance.now() > deadline) throw new Error(`Timed out: ${label}`); await delay(20); }
}
function create(mode, kind) {
  const record = lifecycle.reserve({ kind, ownerId: 1, itemId: mode, creationId: mode, projectContext, root: temporary });
  const events = [];
  const host = createUtilityHost({ utilityProcess, budget, identity: { key: record.executionId, ownerId: 1, projectId: "fixture", kind },
    modulePath: path.join(root, "tests/fixtures/workbench/item-hosts/lifecycle-host.mjs"),
    initialize: { ownerId: 1, mode }, handle: () => {}, onEvent: event => events.push(event) });
  hosts.push(host);
  lifecycle.attach(record, { host });
  return { record, host, events };
}
const watchdog = setTimeout(() => { console.error("Lifecycle smoke deadline exceeded."); app.exit(1); }, 45000);
async function run() {
app.dock?.hide();
let failed = false;
try {
  const stuckStart = create("blocked-initialize", "agent");
  const sibling = create("healthy-terminal", "terminal");
  await sibling.host.ready;
  await until(() => stuckStart.events.some(event => event.type === "blocking-initialize"), "blocked initialize reached");
  const start = performance.now();
  const receipt = lifecycle.terminateRecord(stuckStart.record, "close-starting");
  assert.equal(receipt.desiredLifecycle, "terminated");
  assert.ok(performance.now() - start < 250, "Acceptance waited for the failed utility.");
  assert.deepEqual(await sibling.host.call("ping"), { alive: true });
  await lifecycle.close(sibling.record);
  await until(() => lifecycle.summary(stuckStart.record).cleanup === "confirmed", "stuck initialization force exit");
  assert.ok(performance.now() - start < 6500, "Close waited for the 30-second startup timeout.");

  const stuckDispose = create("blocked-dispose", "agent");
  await stuckDispose.host.ready;
  await lifecycle.close(stuckDispose.record);
  assert.equal(stuckDispose.host.exited, true);

  const nativeTree = create("native-tree", "terminal");
  await nativeTree.host.ready;
  await until(() => nativeTree.host.diagnostics().nativeProcesses.length > 0, "native child ownership");
  const childPid = nativeTree.host.diagnostics().nativeProcesses[0].pid;
  await lifecycle.close(nativeTree.record);
  assert.throws(() => process.kill(childPid, 0), error => error.code === "ESRCH");
  assert.equal(budget.snapshot().length, 0);
  console.log(JSON.stringify({ ok: true, blockedInitializeTerminated: true, blockedDisposeTerminated: true,
    siblingResponsive: true, nativeChildExited: true, resourceLeases: budget.snapshot().length }));
} catch (error) {
  failed = true;
  console.error(error);
  console.error(lifecycle.list());
  console.error(hosts.map(host => host.diagnostics()));
} finally {
  await Promise.all(hosts.map(host => host.close().catch(error => { failed = true; console.error(error); })));
  await fs.rm(temporary, { recursive: true, force: true });
  clearTimeout(watchdog);
  app.exit(failed ? 1 : 0);
}
}
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });
