import { describe, expect, it, vi } from "vitest";
import { createLocalAgentCatalog, defaultLocalAgentCatalog as catalog } from "../../../../electron/main/local-agent-catalog/catalog.mjs";
import { defineLocalAgent, localAgentCapabilities } from "../../../../electron/main/local-agent-catalog/agent-definition.mjs";
import { createSetupRegistry, createCompanionIdentities } from "../../../../electron/main/local-agent-installation/setup/setup-registry.mjs";
import { createActivationRegistry } from "../../../../electron/main/local-agent-activation/activation-registry.mjs";
import { createLocalAgentInstallationRegistry } from "../../../../electron/main/local-agent-installation/installation-registry.mjs";
import { LOCAL_AGENT_INSTALLATION_IDS } from "../../../../shared/local-agent-installation/schema.mjs";
import { AGENT_CHAT_CREATION_RECIPES, localAgentIdForAgentChatRuntime } from "../../../../src/features/app-shell/auxiliary-workbench/agentChatCreationRecipes";
import { DESKTOP_TERMINAL_LAUNCHERS } from "../../../../src/features/desktop-terminal/model/terminalLaunchers";
import { adviseSetup } from "../../../../electron/main/local-agent-installation/setup/setup-advisor.mjs";
import { createLocalAgentSetupService } from "../../../../electron/main/local-agent-installation/setup/setup-service.mjs";

const codex = catalog.find(agent => agent.installation.id === "codex");
const claude = catalog.find(agent => agent.installation.id === "claude");
const mac = { platform: "darwin", arch: "arm64" };

describe("trusted Local Agent capability catalog", () => {
  it("is the complete immutable source for installation, setup and consumer identities", () => {
    expect(catalog.map(agent => agent.installation.id)).toEqual(LOCAL_AGENT_INSTALLATION_IDS);
    expect(createLocalAgentInstallationRegistry()).toEqual(catalog.map(agent => agent.installation));
    const setup = createSetupRegistry();
    expect(setup.map(route => route.runtimeId).sort()).toEqual(AGENT_CHAT_CREATION_RECIPES
      .filter(recipe => recipe.availability !== "bundled").map(recipe => recipe.id).sort());
    expect(setup.flatMap(route => route.terminalRecipeId ? [route.terminalRecipeId] : []).sort())
      .toEqual(DESKTOP_TERMINAL_LAUNCHERS.filter(recipe => recipe.id !== "shell").map(recipe => recipe.id).sort());
    expect(setup.find(route => route.id === "opencode").runtimeId).toBe("opencode-native");
    for (const route of setup) expect(localAgentIdForAgentChatRuntime(route.runtimeId)).toBe(route.installationId);
    expect(setup.filter(route => route.strategy === "app-bundled-runtime").map(route => route.terminalRecipeId)).toEqual([null, null]);
    expect(Object.isFrozen(catalog)).toBe(true);
    for (const agent of catalog) {
      expect(Object.isFrozen(agent.setup.platforms)).toBe(true);
      expect(Object.isFrozen(agent.installation.executableNames)).toBe(true);
    }
    expect(() => { catalog[0].setup.platforms.push("freebsd"); }).toThrow();
    expect(catalog.some(agent => agent.installation.id === "puppyone-agent")).toBe(false);
  });

  it.each(["darwin", "linux", "win32", "freebsd"].flatMap(platform =>
    ["arm64", "x64", "ia32", "riscv64"].map(arch => ({ platform, arch }))))("selects the exact $platform/$arch support matrix", environment => {
    const expected = {
      darwin: ["codex", "claude", "cursor", "opencode", "pi", "workbuddy-china", "workbuddy-international", "hermes"],
      linux: ["codex", "claude", "cursor", "opencode", "pi", "hermes"],
      win32: ["codex", "claude", "opencode", "pi"], freebsd: [],
    }[environment.platform];
    const routes = createActivationRegistry(environment);
    expect([...routes.keys()].sort()).toEqual([...expected].sort());
    for (const agent of catalog) {
      const id = agent.installation.id;
      const capabilities = localAgentCapabilities(agent, environment);
      const automatic = environment.platform === "darwin" && ["arm64", "x64"].includes(environment.arch)
        && ["codex", "cursor"].includes(id);
      expect(capabilities.automaticInstall, id).toBe(automatic);
      expect(capabilities.chat, id).toBe(expected.includes(id));
      expect(capabilities.terminal, id).toBe(expected.includes(id) && !id.startsWith("workbuddy-"));
      expect(capabilities.companionDiscovery, id).toBe(environment.platform === "darwin" && ["codex", "cursor"].includes(id));
      if (routes.has(id)) expect(Boolean(routes.get(id).recipe), id).toBe(automatic);
    }
  });

  it("does not evaluate install recipes or candidate paths while registering or inspecting setup", () => {
    const recipeFor = vi.fn(() => null); const candidatePaths = vi.fn(() => []);
    const custom = createLocalAgentCatalog([{ ...codex, installation: { ...codex.installation, candidatePaths },
      provision: { kind: "managed-artifact", recipeFor } }]);
    createSetupRegistry(custom); createCompanionIdentities(custom);
    createLocalAgentInstallationRegistry(custom.map(agent => agent.installation));
    expect(recipeFor).not.toHaveBeenCalled(); expect(candidatePaths).not.toHaveBeenCalled();
    createActivationRegistry({ ...mac, catalog: custom });
    expect(recipeFor).toHaveBeenCalledExactlyOnceWith("darwin", "arm64");
    expect(candidatePaths).not.toHaveBeenCalled();
  });

  it.each(catalog.flatMap(agent => ["found", "not-found", "failed", "unknown"].map(status => ({ id: agent.installation.id, status }))))
  ("$id/$status: recommendation is evidence-based, never a runtime or brand shortcut", ({ id, status }) => {
    const registry = createSetupRegistry();
    const entries = adviseSetup({ registry, platform: "darwin", now: 0, sessionSuppressed: new Set(),
      request: { surface: "chat", eligibleInstallationIds: [id], hiddenAgentIds: [],
        preferences: { enabled: true, dismissedSetupIds: [], snoozedUntil: {} } },
      installations: { results: [{ agentId: id, status }] },
      companions: [{ companionId: id, status: "present" }],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].recommended).toBe(status === "not-found" && ["codex", "cursor"].includes(id));
    if (["failed", "unknown"].includes(status)) expect(entries[0].status).toBe("unknown");
  });

  it("setup admission uses the injected catalog, not a hidden default product table", async () => {
    const registry = createSetupRegistry(createLocalAgentCatalog([{ ...claude, runtimeId: null }]));
    const openExternal = vi.fn();
    const current = { generation: 1, results: [{ agentId: "claude", status: "not-found" }] };
    const service = createLocalAgentSetupService({ registry, platform: "darwin", openExternal,
      installationService: { getSnapshot: () => current, isScanning: () => false },
      presenceService: { discover: async () => [], dispose() {} } });
    const request = { clientId: "test:1", surface: "chat", eligibleInstallationIds: ["claude", "codex"], hiddenAgentIds: [],
      preferences: { enabled: true, dismissedSetupIds: [], snoozedUntil: {} } };
    expect((await service.inspect(1, request)).entries).toEqual([]);
    const terminal = await service.inspect(1, { ...request, surface: "terminal" });
    expect(terminal.entries.map(entry => entry.setupId)).toEqual(["claude"]);
    await service.act(1, { clientId: "test:1", revision: terminal.revision, setupId: "claude", actionId: "open-guide", mode: "manual" });
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(claude.setup.guideUrl);
    service.dispose();
  });

  it.each([
    ["extra field", { command: "installer" }],
    ["no consumer", { runtimeId: null, terminalRecipeId: null }],
    ["bad consumer", { runtimeId: "../runtime" }],
    ["unknown provision", { provision: { kind: "shell", command: "install" } }],
    ["guided command", { provision: { kind: "guided", command: "install" } }],
    ["missing recipe", { provision: { kind: "managed-artifact", recipeFor: null } }],
    ["invalid companion", { companion: { bundleId: "../Desktop.app" } }],
    ["undeclared companion field", { companion: { bundleId: "com.example.app", path: "/Applications" } }],
    ["unregistered installation", { installation: { ...codex.installation, id: "puppyone-agent" } }],
    ["invalid installation", { installation: { ...codex.installation, executableNames: [] } }],
  ])("rejects %s", (_label, patch) => {
    expect(() => defineLocalAgent({ ...codex, ...patch })).toThrow();
  });

  it.each([
    { guideUrl: "http://example.com" }, { guideUrl: "https://user:secret@example.com" },
    { guideUrl: "file:///etc/passwd" }, { guideUrl: "https://example.com:444" },
    { platforms: [] }, { platforms: ["darwin", "darwin"] }, { platforms: ["freebsd"] },
    { publisher: "" }, { strategy: "unknown" }, { strategy: "app-bundled-runtime" },
  ])("rejects invalid setup policy %j", patch => {
    expect(() => defineLocalAgent({ ...codex, setup: { ...codex.setup, ...patch } })).toThrow();
  });

  it.each(["installation", "runtime", "terminal", "companion"])("rejects duplicate %s identities", field => {
    const second = { ...claude };
    if (field === "installation") second.installation = codex.installation;
    if (field === "runtime") second.runtimeId = codex.runtimeId;
    if (field === "terminal") second.terminalRecipeId = codex.terminalRecipeId;
    if (field === "companion") second.companion = codex.companion;
    expect(() => createLocalAgentCatalog([codex, second])).toThrow("Duplicate Local Agent mapping");
  });

  it.each([
    { setupId: "cursor" }, { binary: "../bin/agent" }, { binary: "/bin/agent" },
    { entry: "bin/agent" }, { version: ".." }, { command: "curl" },
    { artifact: { url: "https://example.com/file", algorithm: "sha1", digest: "bad" } },
    { artifact: { url: "https://example.com/file", algorithm: "sha256", digest: "bad" } },
  ])("fails closed on a malformed recipe %j", patch => {
    const recipe = codex.provision.recipeFor("darwin", "arm64");
    const definition = defineLocalAgent({ ...codex, provision: { kind: "managed-artifact", recipeFor: () => ({ ...recipe, ...patch }) } });
    expect(() => localAgentCapabilities(definition, mac)).toThrow();
  });
});
