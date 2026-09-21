import { randomUUID } from "node:crypto";
import { ACTIVATION_ERRORS, ACTIVATION_STEPS, activationId, assertActivationSnapshot, exactObject, isActivationActive } from "../../../shared/local-agent-activation/schema.mjs";
import { ActivationError } from "./activation-error.mjs";
import { supportsSetupSurface } from "../local-agent-catalog/agent-definition.mjs";

/** Application-owned operations. Cancel never waits behind a provider operation. */
export function createLocalAgentActivationService({ registry, resolveInstallation, installer, createContext,
  journal, openExternal, refreshInstallations, publish = () => {}, now = Date.now }) {
  const epoch = randomUUID();
  const operations = new Map(); const tasks = new Map(); const plans = new Map();
  let revision = 0; let disposed = false;
  const snapshot = () => assertActivationSnapshot({ epoch, revision, operations: structuredClone([...operations.values()]) });
  const initialized = journal.read().then(entries => {
    for (const entry of entries) {
      if (!registry.has(entry.setupId)) continue;
      operations.set(entry.setupId, { ...entry, ...(isActivationActive(entry.status)
        ? { status: "interrupted", errorCode: "interrupted", updatedAt: now(),
          steps: entry.steps.map(value => value.status === "running" ? { ...value, status: "failed" } : value) } : {}) });
    }
    revision++;
  });
  // Prevent an unhandled rejection before the first IPC request. Reads/starts
  // still reject storage failure and never silently overwrite a corrupt journal.
  void initialized.catch(() => {});
  function emit(entry, patch = {}) {
    Object.assign(entry, patch, { updatedAt: now() }); revision++;
    const value = snapshot();
    try { publish(value); } catch { /* A closed view cannot affect work. */ }
    void journal.write(value).catch(() => {});
  }
  function step(entry, id, status) { entry.steps = entry.steps.map(value => value.id === id ? { id, status } : value); }
  function check(task) { task.controller.signal.throwIfAborted(); if (disposed) throw new ActivationError("interrupted"); }
  function routeFor(id, surface) {
    const route = registry.get(activationId(id));
    if (!route || !supportsSetupSurface(route, surface)) throw new ActivationError("unsupported");
    return route;
  }
  function getPlan(ownerId, id) {
    const plan = plans.get(activationId(id));
    if (!plan || plan.ownerId !== ownerId || disposed) throw new Error("Invalid activation plan.");
    return plan;
  }
  async function run(task) {
    const { entry, route } = task;
    const signal = task.controller.signal;
    try {
      check(task);
      step(entry, "prepare", "running"); emit(entry, { status: "preparing", errorCode: null });
      let candidate = await resolveInstallation(route.installationId, signal);
      check(task);
      step(entry, "prepare", "complete");
      if (!candidate && route.recipe) {
        step(entry, "install", "running"); emit(entry, { status: "installing" });
        await installer.install(route.recipe, { signal,
          verify: async (file, installationSignal = signal) => {
            const context = await createContext({ file, signal: installationSignal });
            const result = await context.run(["--version"]);
            if (result.code !== 0 || !`${result.stdout}\n${result.stderr}`.trim()) throw new ActivationError("installation");
          },
          committed: () => { task.committed = true; emit(entry, { installed: true }); },
        });
        check(task);
        step(entry, "install", "complete"); step(entry, "verify", "running");
        emit(entry, { status: "verifying" });
        candidate = await resolveInstallation(route.installationId, signal);
        check(task);
        if (!candidate) throw new ActivationError("installation");
      }
      if (!candidate) {
        step(entry, "install", "pending"); emit(entry, { status: "setup-required" }); return;
      }
      entry.installed = true;
      step(entry, "install", task.committed ? "complete" : "skipped");
      // Discovery is the activation authority for every route. Existing CLIs
      // need no version/account/protocol process here; runtime checks happen on launch.
      check(task); step(entry, "verify", "complete"); emit(entry, { status: "ready" });
    } catch (error) {
      if (signal.aborted || disposed) {
        entry.steps = entry.steps.map(value => value.status === "running" ? { ...value, status: "pending" } : value);
        emit(entry, { status: "cancelled", errorCode: null });
      }
      else {
        entry.steps = entry.steps.map(value => value.status === "running" ? { ...value, status: "failed" } : value);
        emit(entry, { status: "failed", errorCode: ACTIVATION_ERRORS.includes(error.code) ? error.code : "installation" });
      }
    } finally {
      task.running = false;
      // Refresh is a consequence of explicit setup, not of opening a view. It
      // never gates cancellation or retains the installation process.
      if (entry.installed) void Promise.resolve().then(() => refreshInstallations()).catch(() => {});
    }
  }
  function launch(task) {
    task.running = true;
    task.promise = run(task);
    return task.promise;
  }
  return {
    async read() { await initialized; return snapshot(); },
    async plan(ownerId, input) {
      exactObject(input, ["setupId", "surface"]); await initialized;
      if (disposed) throw new ActivationError("interrupted");
      const route = routeFor(input.setupId, input.surface);
      const planId = randomUUID();
      const plan = { planId, setupId: route.id, displayName: route.displayName,
        mode: route.recipe ? "automatic" : "guided", version: route.recipe?.version ?? null,
        publisher: route.publisher, surface: input.surface };
      plans.set(planId, { ownerId, route, plan });
      while (plans.size > 128) plans.delete(plans.keys().next().value);
      return plan;
    },
    async start(ownerId, input) {
      exactObject(input, ["planId"]); await initialized;
      const prepared = getPlan(ownerId, input.planId);
      const { route, plan } = prepared;
      if (prepared.operationId) return snapshot();
      const previous = operations.get(route.id);
      if (previous && isActivationActive(previous.status)) { prepared.operationId = previous.operationId; return snapshot(); }
      if ([...operations.values()].filter(entry => isActivationActive(entry.status)).length >= 3) throw new ActivationError("installation-busy");
      const entry = { operationId: randomUUID(), setupId: route.id, displayName: route.displayName,
        status: "preparing", steps: ACTIVATION_STEPS.map(id => ({ id, status: "pending" })),
        installed: false, errorCode: null, updatedAt: now() };
      const task = { entry, route, surface: plan.surface, controller: new AbortController(), running: false, committed: false };
      operations.set(route.id, entry); tasks.set(entry.operationId, task); revision++;
      prepared.operationId = entry.operationId;
      try { await journal.write(snapshot()); } catch {
        // A late storage failure must not overwrite an already acknowledged cancel.
        if (!task.controller.signal.aborted) emit(entry, { status: "failed", errorCode: "storage" });
        return snapshot();
      }
      if (!isActivationActive(entry.status) || task.controller.signal.aborted) return snapshot();
      for (const [id, older] of tasks) if (older.entry.setupId === route.id && id !== entry.operationId && !older.running) tasks.delete(id);
      void launch(task); return snapshot();
    },
    async act(_ownerId, input) {
      exactObject(input, ["operationId", "action"]);
      // Do not await journal I/O here: a stalled disk or provider cannot block
      // stopping a task already owned by this process.
      activationId(input.operationId);
      if (!["cancel", "check", "guide", "dismiss"].includes(input.action)) throw new Error("Invalid activation action.");
      if (input.action === "dismiss") {
        const entry = [...operations.values()].find(value => value.operationId === input.operationId);
        if (!entry || isActivationActive(entry.status)) throw new Error("Activation is still running.");
        operations.delete(entry.setupId); tasks.delete(entry.operationId); revision++;
        const value = snapshot(); publish(value); void journal.write(value).catch(() => {}); return value;
      }
      const task = tasks.get(input.operationId);
      if (!task || operations.get(task.entry.setupId) !== task.entry) throw new Error("Unknown activation operation.");
      const { entry, route } = task;
      if (input.action === "cancel") {
        if (!isActivationActive(entry.status) || entry.status === "cancelling") return snapshot();
        emit(entry, { status: "cancelling" }); task.controller.abort(new ActivationError("interrupted"));
        if (!task.running) {
          entry.steps = entry.steps.map(value => value.status === "running" ? { ...value, status: "pending" } : value);
          emit(entry, { status: "cancelled" });
        }
      } else if (input.action === "guide") {
        if (entry.status !== "setup-required") throw new Error("Guide is unavailable.");
        await openExternal(route.guideUrl);
      } else {
        if (disposed || task.running || entry.status !== "setup-required") return snapshot();
        void launch(task);
      }
      return snapshot();
    },
    async openGuide(ownerId, input) {
      exactObject(input, ["planId"]);
      await openExternal(getPlan(ownerId, input.planId).route.guideUrl);
    },
    release(ownerId) { for (const [id, plan] of plans) if (plan.ownerId === ownerId) plans.delete(id); },
    dispose() {
      disposed = true; plans.clear();
      for (const task of tasks.values()) if (isActivationActive(task.entry.status)) {
        task.controller.abort(new ActivationError("interrupted"));
      }
    },
    async settled() { await Promise.all([...tasks.values()].map(task => task.promise)); },
  };
}
