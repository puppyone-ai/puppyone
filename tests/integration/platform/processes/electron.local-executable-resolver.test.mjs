import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertExecutableIdentity, createExecutableSearchContext, createLocalAgentExecutableResolver,
  executableCandidateLimits } from "../../../../electron/main/local-agent-installation/executable-resolver.mjs";
import { createExecutableDiscoveryPort } from "../../../../electron/main/platform/common/executable-discovery-port.mjs";
import { createLocalAgentInstallationRegistry, defaultLocalAgentInstallationRegistry } from "../../../../electron/main/local-agent-installation/installation-registry.mjs";
import { createLocalAgentInstallationService } from "../../../../electron/main/local-agent-installation/installation-service.mjs";
import { workBuddyInstallationDefinition } from "../../../../electron/main/local-agent-installation/definitions/workbuddy.mjs";
import { createTerminalAgentLaunchResolver } from "../../../../electron/main/terminal-agent/terminal-agent-launch-resolver.mjs";
import { createTerminalShellHost } from "../../../../electron/main/terminal-shell-host.mjs";
import { discoverCodexExecutable } from "../../../../electron/main/agent/runtimes/codex/codex-discovery.mjs";
import { runBoundedProcessProbe } from "../../../../electron/main/platform/common/bounded-process-probe.mjs";
import { readUserCommandEnvironment } from "../../../../electron/main/platform/common/command-environment.mjs";

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const providedEnvironment = async ({ env }) => ({ environment: { ...env }, complete: true, source: "provided" });
async function fixture(env = {}, platform = "linux") {
  const home = await mkdtemp(path.join(os.tmpdir(), "puppyone-installation-"));
  roots.push(home);
  const port = createExecutableDiscoveryPort({ env, homedir: home, nodePlatform: platform, readEnvironment: providedEnvironment });
  return { home, port, resolver: createLocalAgentExecutableResolver({ discoveryPort: port }) };
}
async function executable(file, text = "#!/bin/sh\n# pi-coding-agent cursor-agent\n") {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  await chmod(file, 0o755);
  return file;
}

describe("ordered installation discovery", () => {
  it.each(["codex", "claude", "pi", "cursor", "opencode", "workbuddy", "hermes"])("discovers %s in an arbitrary PATH without package-manager knowledge", async (id) => {
    const env = {};
    const { home, resolver } = await fixture(env);
    const bin = path.join(home, "entirely custom", "tools");
    env.PATH = bin;
    const file = await executable(path.join(bin, id === "cursor" ? "cursor-agent" : id === "workbuddy" ? "codebuddy" : id));
    await expect(resolver.resolve(id)).resolves.toMatchObject({ status: "found",
      candidate: { executablePath: file, canonicalIdentity: await realpath(file), source: "path-installation" } });
  });

  it("keeps PATH precedence, including a version manager's selected shim", async () => {
    const env = {};
    const { home, resolver } = await fixture(env);
    const first = await executable(path.join(home, "selected-version", "codex"));
    await executable(path.join(home, "newer-but-not-selected", "codex"));
    await executable(path.join(home, ".local", "bin", "codex"));
    env.PATH = [path.dirname(first), path.join(home, "newer-but-not-selected")].join(path.delimiter);
    await expect(resolver.resolve("codex")).resolves.toMatchObject({ candidate: { executablePath: first } });
  });

  it("does not discover an inactive NVM installation outside PATH", async () => {
    const { home, resolver } = await fixture({ PATH: "" });
    await executable(path.join(home, ".nvm", "versions", "node", "v999.0.0", "bin", "codex"));
    await expect(resolver.resolve("codex")).resolves.toMatchObject({ status: "not-found" });
  });

  it("keeps an invalid explicit override visible instead of selecting another install", async () => {
    const env = {};
    const { home, resolver } = await fixture(env);
    env.CODEX_PATH = path.join(home, "missing-codex");
    env.PATH = path.join(home, "bin");
    await executable(path.join(env.PATH, "codex"));
    await expect(resolver.resolve("codex")).resolves.toMatchObject({ status: "failed", reasonCode: "configured-path-not-found" });
  });

  it.each(["CODEX_INSTALL_DIR", "PI_CODING_AGENT_DIR", "PI_MANAGED_INSTALL_ROOT"])("treats %s as an installer hint, not an executable override", async (key) => {
    const env = {};
    const { home, resolver } = await fixture(env);
    env[key] = path.join(home, "custom-state-or-installer-directory");
    env.PATH = path.join(home, "bin");
    const id = key === "CODEX_INSTALL_DIR" ? "codex" : "pi";
    const file = await executable(path.join(env.PATH, id));
    await expect(resolver.resolve(id)).resolves.toMatchObject({ status: "found", candidate: { executablePath: file } });
  });

  it.each([
    ["codex", [".local", "bin", "codex"]],
    ["claude", [".local", "bin", "claude"]],
    ["claude", [".claude", "local", "claude"]],
    ["pi", [".pi", "agent", "bin", "pi"]],
    ["pi", [".local", "bin", "pi"]],
  ])("retains the documented %s fallback %j", async (id, parts) => {
    const { home, resolver } = await fixture({ PATH: "" });
    const file = await executable(path.join(home, ...parts));
    await expect(resolver.resolve(id)).resolves.toMatchObject({ status: "found", candidate: { executablePath: file, source: "product-fallback" } });
  });

  it.each(["@earendil-works", "@mariozechner"])("preserves the npm entrypoint while checking %s Pi's canonical package identity", async (scope) => {
    const env = {};
    const { home, resolver } = await fixture(env);
    const pkg = path.join(home, "node_modules", scope, "pi-coding-agent");
    const target = await executable(path.join(pkg, "dist", "cli.js"), "#!/usr/bin/env node\n");
    await writeFile(path.join(pkg, "package.json"), JSON.stringify({ name: `${scope}/pi-coding-agent` }));
    env.PATH = path.join(home, "bin");
    await mkdir(env.PATH);
    const entry = path.join(env.PATH, "pi");
    await symlink(target, entry);
    const result = await resolver.resolve("pi");
    expect(result).toMatchObject({ status: "found", candidate: { executablePath: entry, canonicalIdentity: await realpath(target) } });
    await expect(assertExecutableIdentity(result.candidate)).resolves.toBe(entry);
    await rm(entry);
    await symlink(await executable(path.join(home, "replacement")), entry);
    await expect(assertExecutableIdentity(result.candidate)).rejects.toThrow("changed identity");
  });

  it.each(["pi", "agent"])("rejects the unrelated ambiguous command %s", async (name) => {
    const env = {};
    const { home, resolver } = await fixture(env);
    env.PATH = path.join(home, "bin");
    await executable(path.join(env.PATH, name), "#!/bin/sh\n# unrelated application\n");
    await expect(resolver.resolve(name === "pi" ? "pi" : "cursor")).resolves.toMatchObject({ status: "failed", reasonCode: "identity-mismatch" });
  });

  it("accepts the cbc alias only with bounded CodeBuddy product identity", async () => {
    const env = {};
    const { home, resolver } = await fixture(env);
    const pkg = path.join(home, "node_modules", "@tencent-ai", "codebuddy-code");
    const target = await executable(path.join(pkg, "bin", "codebuddy"), "#!/usr/bin/env node\n");
    await writeFile(path.join(pkg, "package.json"), JSON.stringify({ name: "@tencent-ai/codebuddy-code" }));
    env.PATH = path.join(home, "bin");
    await mkdir(env.PATH);
    const entry = path.join(env.PATH, "cbc");
    await symlink(target, entry);
    await expect(resolver.resolve("workbuddy")).resolves.toMatchObject({
      status: "found",
      candidate: { executablePath: entry, invokedAs: "cbc" },
    });

    await rm(entry);
    await executable(entry, "#!/bin/sh\n# unrelated cbc command\n");
    await expect(resolver.resolve("workbuddy")).resolves.toMatchObject({
      status: "failed",
      reasonCode: "identity-mismatch",
    });
  });

  it("keeps WorkBuddy overrides and packaged desktop-app entrypoints in the shared installation definition", () => {
    const candidates = workBuddyInstallationDefinition.candidatePaths({
      env: { CODEBUDDY_CODE_PATH: "/opt/workbuddy/codebuddy" },
      homedir: "/Users/test",
      platform: "darwin",
    });
    expect(candidates).toEqual(expect.arrayContaining([
      { path: "/opt/workbuddy/codebuddy", source: "environment-override" },
      {
        path: "/Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy",
        source: "product-fallback",
      },
      {
        path: "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy",
        source: "product-fallback",
      },
    ]));
  });

  it("reports a search budget failure instead of silently ignoring the end of PATH", async () => {
    const PATH = Array.from({ length: executableCandidateLimits.maxPathDirectories + 1 }, (_, i) => `/tools/${i}`).join(":");
    await expect(createExecutableSearchContext({ env: { PATH }, platform: "linux" })).rejects.toThrow("budget");
  });

  it.each(["codex", "claude", "pi", "workbuddy"])("respects Windows PATHEXT when resolving npm %s entrypoints", async (id) => {
    const env = { PATHEXT: ".CMD;.EXE" };
    const { home, resolver } = await fixture(env, "win32");
    env.PATH = path.join(home, "npm commands");
    const executableName = id === "workbuddy" ? "codebuddy" : id;
    const cmd = await executable(path.join(env.PATH, `${executableName}.cmd`));
    await executable(path.join(env.PATH, `${executableName}.exe`));
    await expect(resolver.resolve(id)).resolves.toMatchObject({ candidate: { executablePath: cmd } });
  });

  it("detects Codex's Windows standalone installation without PATH", async () => {
    const env = { PATH: "" };
    const { home, resolver } = await fixture(env, "win32");
    env.LOCALAPPDATA = path.join(home, "Local App Data");
    const file = await executable(path.join(env.LOCALAPPDATA, "Programs", "OpenAI", "Codex", "bin", "codex.exe"));
    await expect(resolver.resolve("codex")).resolves.toMatchObject({ candidate: { executablePath: file } });
  });

  it("distinguishes failed environment acquisition from a completed negative result", async () => {
    const { home } = await fixture();
    const port = createExecutableDiscoveryPort({ homedir: home, nodePlatform: "linux", readEnvironment: async () => ({
      environment: { PATH: "" }, complete: false, source: "inherited-environment", reasonCode: "environment-unavailable",
    }) });
    const service = createLocalAgentInstallationService({ discoveryPort: port });
    await expect(service.discover()).resolves.toMatchObject({ results: expect.arrayContaining([
      expect.objectContaining({ agentId: "codex", status: "failed", reasonCode: "environment-unavailable" }),
    ]) });
    await executable(path.join(home, ".local", "bin", "codex"));
    await expect(service.discover()).resolves.toMatchObject({ source: "scan", availableAgentIds: ["codex"] });
    service.dispose();
  });
});

describe.skipIf(process.platform === "win32" || !existsSync("/bin/zsh"))("fresh shell environment across discovery and launch", () => {
  it("bounds a blocking shell profile and succeeds after the profile is fixed", async () => {
    const { home } = await fixture();
    const env = { HOME: home, ZDOTDIR: home, SHELL: "/bin/zsh", PATH: "/usr/bin:/bin" };
    await writeFile(path.join(home, ".zshrc"), "/bin/sleep 30\n");
    await expect(readUserCommandEnvironment({ env, homedir: home, timeoutMs: 100 }))
      .resolves.toMatchObject({ complete: false, reasonCode: "environment-unavailable" });
    await writeFile(path.join(home, ".zshrc"), "export PATH='/new/custom/bin:/usr/bin:/bin'\n");
    await expect(readUserCommandEnvironment({ env, homedir: home }))
      .resolves.toMatchObject({ complete: true, environment: { PATH: "/new/custom/bin:/usr/bin:/bin" } });
  });
  it("finds a newly installed CLI after refresh, and launches the same entrypoint with its interpreter environment", async () => {
    const { home } = await fixture();
    const oldBin = path.join(home, "previous tools");
    const newBin = path.join(home, "new tools");
    await executable(path.join(oldBin, "claude"));
    const env = { HOME: home, ZDOTDIR: home, SHELL: "/bin/zsh", PATH: "/usr/bin:/bin" };
    const configure = (bin) => writeFile(path.join(home, ".zshrc"),
      `printf 'startup noise=not environment\\n'\nexport PATH='${bin}:/usr/bin:/bin'\nexport CLI_FIXTURE='selected environment'\n`);
    await configure(oldBin);
    const basePort = createExecutableDiscoveryPort({ env, homedir: home });
    const capture = vi.fn(basePort.captureEnvironment);
    const port = { ...basePort, captureEnvironment: capture };
    const registry = createLocalAgentInstallationRegistry(defaultLocalAgentInstallationRegistry.filter(({ id }) => ["codex", "claude"].includes(id)));
    const service = createLocalAgentInstallationService({ registry, discoveryPort: port });
    await expect(service.discover()).resolves.toMatchObject({ availableAgentIds: ["claude"] });
    const codex = await executable(path.join(newBin, "codex"),
      '#!/usr/bin/env node\nconsole.log(process.argv.includes("--version") ? "codex-cli 0.144.1" : process.env.CLI_FIXTURE);\n');
    await symlink(process.execPath, path.join(newBin, "node"));
    await configure(newBin);
    await expect(service.discover()).resolves.toMatchObject({ source: "memory-cache", availableAgentIds: ["claude"] });
    const refreshed = await service.discover({ refresh: true });
    expect(refreshed.availableAgentIds).toEqual(["codex"]);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(refreshed)).not.toContain(home);
    const launch = await createTerminalAgentLaunchResolver({ discoveryPort: port })("codex");
    expect(launch.executablePath).toBe(codex);
    const host = createTerminalShellHost({ agentLaunch: launch, environment: env });
    expect(host.loginShell).toBe(false);
    expect(host.commandEnvironment.PATH).toBe(`${newBin}:/usr/bin:/bin`);
    const executed = await runBoundedProcessProbe(launch.executablePath, [], { env: host.commandEnvironment });
    expect(executed.stdout.trim()).toBe("selected environment");
    const readiness = await discoverCodexExecutable({ env, homedir: home });
    expect(readiness).toMatchObject({ status: "ready", executablePath: codex, version: "0.144.1",
      environment: { PATH: host.commandEnvironment.PATH } });
    await rm(codex);
    await expect(createTerminalAgentLaunchResolver({ discoveryPort: port })("codex")).rejects.toThrow("TERMINAL_AGENT_UNAVAILABLE");
    service.dispose();
  });
});
