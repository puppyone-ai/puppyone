#!/usr/bin/env electron
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, WebContentsView, session, ipcMain, utilityProcess, MessageChannelMain } from "electron";
import { createItemDisplayManager } from "../electron/main/item-hosts/display-manager.mjs";
import { createItemHostBudget } from "../electron/main/item-hosts/resource-budget.mjs";
import { createItemRendererAuthority } from "../electron/main/item-hosts/renderer-authority.mjs";
import { createTerminalProcessService } from "../electron/main/item-hosts/terminal-process-service.mjs";
import { createAgentProcessService } from "../electron/main/item-hosts/agent-process-service.mjs";
import { createTrustedIpcMain } from "../electron/main/trusted-ipc.mjs";
import { registerItemHostIpc } from "../electron/main/item-hosts/ipc.mjs";
import { registerAgentIpcHandlers } from "../electron/main/ipc/agent-ipc.mjs";
import { createAgentService } from "../electron/main/agent/application/agent-service.mjs";
import { createAgentConversationCatalog } from "../electron/main/agent/persistence/agent-conversation-catalog.mjs";
import { createAgentSessionRepository } from "../electron/main/agent/persistence/agent-session-repository.mjs";
import { createEphemeralAgentSessionCache } from "../electron/main/agent/cache/ephemeral-agent-session-cache.mjs";
import { createFixtureAgentRuntime } from "./fixtures/item-agent-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-item-renderer-smoke-"));
const output = path.join(root, "generated", "item-isolation-smoke");
app.setPath("userData", path.join(fixture, "profile"));
process.env.HOME = fixture;
process.env.SHELL = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
process.env.ZDOTDIR = fixture;
delete process.env.ELECTRON_RUN_AS_NODE;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, label) {
  const end = Date.now() + 15_000;
  while (!await predicate()) { if (Date.now() > end) throw new Error(`Timed out: ${label}`); await delay(50); }
}
const watchdog = setTimeout(() => { console.error("Renderer smoke exceeded its deadline."); app.exit(1); }, 180_000);
app.on("window-all-closed", () => {});

async function run() {
  app.dock?.hide();
  await fs.mkdir(output, { recursive: true });
  const window = new BrowserWindow({ width: 1200, height: 800, show: false, webPreferences: { sandbox: true } });
  await window.loadURL("data:text/html,<body style='background:%23eee'>Shell fixture</body>");
  const owner = window.webContents;
  const context = { projectId: "fixture-project", generation: "fixture-generation", rootPath: fixture };
  const projectSessions = {
    require: (id, value) => { assert.equal(id, owner.id); assert.deepEqual(value, context); return context; },
    run: async (id, value, fn) => { projectSessions.require(id, value); return fn({ assertCurrent() {} }); },
  };
  const authority = createItemRendererAuthority();
  const budget = createItemHostBudget({}, { readMetrics: () => app.getAppMetrics() });
  const applicationUrl = pathToFileURL(path.join(root, "dist", "index.html")).href;
  const trusted = createTrustedIpcMain({ ipcMain, applicationUrl, itemRendererAuthority: authority });
  const catalog = createAgentConversationCatalog({ filePath: path.join(fixture, "catalog.json") });
  const attachments = { revoke: async () => {}, revokeOwner: async () => {}, revokeWorkspace: async () => {}, releaseLease: async () => {}, revokeLeased: async () => {} };
  const catalogService = createAgentService({ runtimeRegistry: createFixtureAgentRuntime(),
    sessionCache: createAgentSessionRepository({ eventCache: createEphemeralAgentSessionCache(), conversationCatalog: catalog }), conversationCatalog: catalog });
  let manager;
  const events = [];
  const onHostEvent = (record, event) => { events.push(event); manager?.hostEvent(record, event); };
  const terminalService = createTerminalProcessService({ utilityProcess, modulePath: path.join(root, "electron/utility/terminal/main.mjs"),
    budget, appVersion: "fixture", initializeWorkspaceEditReview: async () => {}, onHostEvent });
  const agentService = createAgentProcessService({ utilityProcess, modulePath: path.join(root, "scripts/fixtures/item-agent-utility.mjs"),
    budget, appVersion: "fixture", catalogService, conversationCatalog: catalog, attachmentStore: attachments, onHostEvent });
  let nativeCreateAttempts = 0;
  const createSession = agentService.createSession;
  agentService.createSession = (...args) => { nativeCreateAttempts += 1; return createSession(...args); };
  manager = createItemDisplayManager({ WebContentsView, electronSession: session, MessageChannelMain, authority, budget,
    getOwnerWindow: () => window, projectSessions, terminalService, agentService, attachmentStore: attachments,
    applicationUrl, preloadPath: path.join(root, "electron/item-preload.cjs") });
  registerItemHostIpc({ ipcMain, trustedIpcMain: trusted, authority, manager, projectSessions });
  trusted.handle("localization:get-bootstrap", () => ({ preference: "en", systemLanguages: ["en"] }));
  registerAgentIpcHandlers({ ipcMain: trusted, agentService, projectSessions,
    localAgentInventory: { discover: async () => ({ connections: [], scannedAt: new Date().toISOString(), warnings: [] }) },
    authorizeWorkspaceRoot: async () => fixture, attachmentStore: attachments });
  const errors = [];
  const warnings = [];
  app.on("web-contents-created", (_event, wc) => wc.on("console-message", ({ level, message }) => {
    if (level === "error") errors.push(message);
    if (level === "warning" && !message.includes("Electron Security Warning")) warnings.push(message);
  }));
  let failed = false;
  try {
    console.log("Creating independent terminal displays...");
    const a = await manager.create(owner, { itemId: "terminal-a", kind: "terminal", projectContext: context, recipeId: "shell" });
    const b = await manager.create(owner, { itemId: "terminal-b", kind: "terminal", projectContext: context, recipeId: "shell" });
    const native = await agentService.createSession({ id: owner.id, hostItemId: "agent-a" }, { runtimeId: "codex", rootPath: fixture, projectContext: context }, fixture);
    console.log("Creating a display replica of the fixture Agent...");
    const chat = await manager.create(owner, { itemId: "agent-a", kind: "agent", projectContext: context });
    assert.equal(new Set([owner.getOSProcessId(), a.processId, b.processId, chat.processId]).size, 4);
    const entry = (id) => manager.values().find((value) => value.itemId === id);
    const configure = (id, bounds, revision) => {
      const identity = { itemId: id, projectContext: context, generation: entry(id).generation, presentationId: 1 };
      manager.configure(owner, { ...identity, presented: true, commandTarget: true });
      manager.geometry(owner, { ...identity, revision, bounds, visible: true });
    };
    window.showInactive();
    configure("terminal-a", { x: 0, y: 0, width: 550, height: 700 }, 1);
    configure("agent-a", { x: 550, y: 0, width: 600, height: 700 }, 1);
    await delay(1000);
    const receipt = entry("terminal-a").terminalReceipt;
    terminalService.input(owner, { ...receipt, data: "stty -echo\r" });
    await delay(100);
    terminalService.input(owner, { ...receipt, data: "printf 'terminal-display-ready\\n'\r" });
    await until(() => entry("terminal-a").view.webContents.executeJavaScript("document.querySelectorAll('.xterm canvas').length > 0"), "terminal canvas mount");
    const terminalWc = entry("terminal-a").view.webContents;
    terminalWc.focus();
    for (const char of "printf input-received > renderer-input.txt") terminalWc.sendInputEvent({ type: "char", keyCode: char });
    terminalWc.sendInputEvent({ type: "keyDown", keyCode: "Return" });
    terminalWc.sendInputEvent({ type: "keyUp", keyCode: "Return" });
    await until(() => fs.readFile(path.join(fixture, "renderer-input.txt"), "utf8").then((value) => value === "input-received").catch(() => false), "direct terminal input delivery");
    await delay(300);
    for (const id of ["terminal-a", "agent-a"]) {
      const wc = entry(id).view.webContents;
      const image = await wc.capturePage();
      assert.equal(image.isEmpty(), false);
      const bitmap = image.toBitmap();
      await fs.writeFile(path.join(output, `${id}-desktop.png`), image.toPNG());
      assert(await wc.executeJavaScript("document.querySelector('.desktop-item-renderer').getBoundingClientRect().width >= 240"), `${id} layout collapsed`);
      assert(new Set(bitmap).size > 10, `${id} canvas is blank`);
    }
    const agentPid = agentService.diagnostics()[0].pid;
    const draft = { revision: (entry("agent-a").draft?.revision ?? 0) + 1, text: "retained fixture draft", references: [], mentions: [], referenceEpoch: "fixture-epoch" };
    manager.saveDraft(entry("agent-a"), draft);
    entry("agent-a").view.webContents.forcefullyCrashRenderer();
    await until(() => entry("agent-a").display === "crashed", "Agent Renderer crash containment");
    assert.equal(await owner.executeJavaScript("6 * 7"), 42);
    assert.equal(await entry("terminal-b").view.webContents.executeJavaScript("6 * 7"), 42);
    const recovered = await manager.recover(owner, { itemId: "agent-a", projectContext: context });
    assert.notEqual(recovered.processId, chat.processId);
    assert.equal(agentService.diagnostics()[0].pid, agentPid);
    assert.equal(agentService.findItemSession(owner.id, "agent-a").instanceId, native.session.instanceId);
    configure("agent-a", { x: 0, y: 0, width: 360, height: 480 }, 2);
    await until(() => entry("agent-a").view.webContents.executeJavaScript("document.body.innerText.includes('retained fixture draft') || [...document.querySelectorAll('textarea')].some(e => e.value.includes('retained fixture draft'))"), "draft restoration");
    await fs.writeFile(path.join(output, "agent-a-narrow.png"), (await entry("agent-a").view.webContents.capturePage()).toPNG());
    assert.equal(nativeCreateAttempts, 1, "Display recovery attempted to create another native Agent session.");
    assert.equal(await entry("agent-a").view.webContents.executeJavaScript("document.querySelectorAll('[role=alert]').length"), 0);
    entry("terminal-a").view.webContents.forcefullyCrashRenderer();
    await until(() => entry("terminal-a").display === "crashed", "Terminal Renderer crash containment");
    terminalService.input(owner, { ...receipt, data: "printf 'retained-after-crash\\n'\r" });
    await delay(100);
    await manager.recover(owner, { itemId: "terminal-a", projectContext: context });
    configure("terminal-a", { x: 380, y: 0, width: 360, height: 480 }, 2);
    await until(() => entry("terminal-a").view.webContents.executeJavaScript("document.querySelectorAll('.xterm canvas').length > 0"), "Terminal display remount");
    await delay(500);
    assert.equal(terminalService.getDisplayReceipt(owner, receipt).pid, receipt.pid);
    await fs.writeFile(path.join(output, "terminal-a-narrow.png"), (await entry("terminal-a").view.webContents.capturePage()).toPNG());
    console.log("Checking mixed-instance admission, output pressure and a blocked display...");
    const otherAgent = await agentService.createSession({ id: owner.id, hostItemId: "agent-b" }, { runtimeId: "codex", rootPath: fixture, projectContext: context }, fixture);
    await manager.create(owner, { itemId: "agent-b", kind: "agent", projectContext: context });
    const admissions = [];
    for (let count = 5; count <= 16; count += 1) {
      try {
        await manager.create(owner, { itemId: `terminal-load-${count}`, kind: "terminal", projectContext: context, recipeId: "shell" });
      } catch (error) { assert.equal(error.code, "HOST_BUDGET_EXHAUSTED"); }
      if ([8, 16].includes(count)) admissions.push({ requested: count, admitted: manager.values().length, leases: budget.snapshot().length });
    }
    assert(admissions.every((value) => value.admitted === 6 && value.leases === 12));
    const latencies = [];
    for (const terminal of manager.values().filter((value) => value.kind === "terminal")) {
      terminalService.input(owner, { ...terminal.terminalReceipt, data: "yes output-pressure | head -c 2097152\r" });
    }
    void entry("terminal-b").view.webContents.executeJavaScript("while (true) {}").catch(() => {});
    for (let index = 0; index < 50; index += 1) {
      const start = performance.now();
      assert.equal(await owner.executeJavaScript("21 * 2"), 42);
      assert.equal(await entry("agent-a").view.webContents.executeJavaScript("21 * 2"), 42);
      latencies.push(performance.now() - start);
      await delay(40);
    }
    await until(() => entry("terminal-b").display === "unresponsive", "external blocked-Renderer detection");
    await manager.recover(owner, { itemId: "terminal-b", projectContext: context });
    assert.equal(await entry("terminal-b").view.webContents.executeJavaScript("21 * 2"), 42);
    process.kill(agentService.diagnostics().find((value) => value.itemId === "agent-b").pid, "SIGKILL");
    await until(() => entry("agent-b").execution === "interrupted", "Agent utility crash containment");
    assert.equal(agentService.findItemSession(owner.id, "agent-a").instanceId, native.session.instanceId);
    assert.notEqual(otherAgent.session.instanceId, native.session.instanceId);
    assert.equal(await owner.executeJavaScript("21 * 2"), 42);
    latencies.sort((x, y) => x - y);
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    assert(p95 < 1000, "Unaffected display RPC became unresponsive under output pressure.");
    await manager.closeAll();
    assert.equal(budget.snapshot().length, 0);
    assert.deepEqual(errors, []);
    const result = { ok: true, rendererPids: [a.processId, b.processId, chat.processId], agentUtilityPid: agentPid,
      displayRecoveryWithoutExecutionRestart: true, draftRestored: true, siblingResponsive: true,
      admissions, unaffectedDisplayRoundtripP95Ms: p95, blockedRendererRecovery: true, agentUtilityCrashContained: true, warnings, screenshots: output };
    await fs.writeFile(path.join(output, "result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    failed = true;
    console.error(error);
    console.error(JSON.stringify({ errors, events, states: manager.values().map(({ itemId, display, message }) => ({ itemId, display, message })) }, null, 2));
  } finally {
    await manager.closeAll().catch((error) => { failed = true; console.error(error); });
    await terminalService.closeAll();
    await agentService.closeAll();
    window.destroy();
    await session.defaultSession.closeAllConnections();
    await fs.rm(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    clearTimeout(watchdog);
    app.exit(failed ? 1 : 0);
  }
}
app.whenReady().then(run).catch((error) => { console.error(error); clearTimeout(watchdog); app.exit(1); });
