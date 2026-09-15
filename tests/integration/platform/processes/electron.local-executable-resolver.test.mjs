import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createExecutableSearchContext,
  executableCandidateLimits,
  resolveFirstExecutable,
} from "../../../../electron/main/local-agent-installation/executable-resolver.mjs";
import { createExecutableDiscoveryPort } from "../../../../electron/main/platform/common/executable-discovery-port.mjs";
import { createLocalAgentExecutableResolver } from "../../../../electron/main/local-agent-installation/executable-resolver.mjs";
import {
  createLocalAgentInstallationRegistry,
  defaultLocalAgentInstallationRegistry,
  getLocalAgentInstallationDefinition,
} from "../../../../electron/main/local-agent-installation/installation-registry.mjs";
import { verifyLocalAgentCandidateIdentity } from "../../../../electron/main/local-agent-installation/candidate-identity.mjs";
import { createLocalAgentInstallationService } from "../../../../electron/main/local-agent-installation/installation-service.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe("local executable search context", () => {
  it.each([
    ["npm global prefix", (home) => path.join(home, ".npm-global", "bin")],
    ["local installer", (home) => path.join(home, ".local", "bin")],
    ["pnpm home", (home) => path.join(home, "pnpm-bin")],
    ["inherited PATH", (home) => path.join(home, "custom-bin")],
  ])("finds Codex from a GUI-safe %s location", async (_label, directoryForHome) => {
    const homedir = await makeTemporaryDirectory();
    const directory = directoryForHome(homedir);
    const executablePath = path.join(directory, "codex");
    await writeExecutable(executablePath, "#!/bin/sh\n# codex fixture\n");
    const resolver = createLocalAgentExecutableResolver({
      discoveryPort: createExecutableDiscoveryPort({
        env: {
          PATH: directory.endsWith("custom-bin") ? directory : "",
          PNPM_HOME: directory.endsWith("pnpm-bin") ? directory : undefined,
        },
        homedir,
        nodePlatform: "darwin",
      }),
    });

    await expect(resolver.resolve("codex")).resolves.toMatchObject({
      status: "found",
      candidate: { executablePath: await realpath(executablePath) },
    });
  });

  it("reports a broken explicit Codex override instead of silently selecting another install", async () => {
    const homedir = await makeTemporaryDirectory();
    const pathDirectory = path.join(homedir, "working-path");
    await writeExecutable(path.join(pathDirectory, "codex"), "#!/bin/sh\n# fallback codex fixture\n");
    const resolver = createLocalAgentExecutableResolver({
      discoveryPort: createExecutableDiscoveryPort({
        env: {
          PATH: pathDirectory,
          CODEX_PATH: path.join(homedir, "missing-explicit-codex"),
        },
        homedir,
        nodePlatform: "darwin",
      }),
    });

    await expect(resolver.resolve("codex")).resolves.toEqual({
      status: "failed",
      reasonCode: "configured-path-not-found",
    });
  });

  it.each([
    ["CODEX_INSTALL_DIR", "darwin", (home) => path.join(home, "custom-codex"), "codex"],
    ["Windows standalone default", "win32", (home) => path.join(home, "Programs", "OpenAI", "Codex", "bin"), "codex.exe"],
  ])("finds Codex from the %s location", async (_label, platform, directoryForHome, executableName) => {
    const homedir = await makeTemporaryDirectory();
    const installDirectory = directoryForHome(homedir);
    const executablePath = path.join(installDirectory, executableName);
    await writeExecutable(executablePath, "#!/bin/sh\n# codex fixture\n");
    const resolver = createLocalAgentExecutableResolver({
      discoveryPort: createExecutableDiscoveryPort({
        env: platform === "win32"
          ? { PATH: "", LOCALAPPDATA: homedir }
          : { PATH: "", CODEX_INSTALL_DIR: installDirectory },
        homedir,
        nodePlatform: platform,
      }),
    });

    await expect(resolver.resolve("codex")).resolves.toMatchObject({
      status: "found",
      candidate: { executablePath: await realpath(executablePath) },
    });
  });

  it("accepts a Windows npm Pi command shim by its embedded package identity", async () => {
    const homedir = await makeTemporaryDirectory();
    const appData = path.join(homedir, "AppData", "Roaming");
    const commandPath = path.join(appData, "npm", "pi.cmd");
    await writeExecutable(
      commandPath,
      "@node %~dp0\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.js %*\r\n",
    );
    const resolver = createLocalAgentExecutableResolver({
      discoveryPort: createExecutableDiscoveryPort({
        env: { PATH: "", APPDATA: appData }, homedir, nodePlatform: "win32",
      }),
    });

    await expect(resolver.resolve("pi")).resolves.toMatchObject({
      status: "found",
      candidate: { executablePath: await realpath(commandPath), invokedAs: "pi" },
    });
  });

  it("covers common GUI-safe Node managers once and bounds NVM traversal", async () => {
    const homedir = await makeTemporaryDirectory();
    const versionsRoot = path.join(homedir, ".nvm", "versions", "node");
    await Promise.all(Array.from({ length: 36 }, (_, index) => (
      mkdir(path.join(versionsRoot, `v20.${index}.0`, "bin"), { recursive: true })
    )));

    const context = await createExecutableSearchContext({
      env: { PATH: "" },
      homedir,
      platform: "darwin",
    });
    const directories = context.directories.map(({ directory }) => directory);
    expect(directories).toContain(path.join(homedir, ".volta", "bin"));
    expect(directories).toContain(path.join(homedir, ".asdf", "shims"));
    const nvmDirectories = directories.filter((directory) => directory.startsWith(versionsRoot));
    expect(nvmDirectories).toHaveLength(executableCandidateLimits.maxNodeManagerVersions);
    expect(nvmDirectories[0]).toBe(path.join(versionsRoot, "v20.35.0", "bin"));
    expect(nvmDirectories).not.toContain(path.join(versionsRoot, "v20.0.0", "bin"));
    expect(directories.length).toBeLessThanOrEqual(executableCandidateLimits.maxSearchDirectories);
  });

  it.each([
    ["macOS pnpm", "darwin", {}, (home) => path.join(home, "Library", "pnpm")],
    ["Linux pnpm", "linux", {}, (home) => path.join(home, ".local", "share", "pnpm")],
    ["Yarn classic", "darwin", {}, (home) => path.join(home, ".yarn", "bin")],
    ["mise", "darwin", {}, (home) => path.join(home, ".local", "share", "mise", "shims")],
    ["fnm default alias", "darwin", {}, (home) => path.join(home, ".local", "share", "fnm", "aliases", "default", "bin")],
    ["Apple Silicon Homebrew", "darwin", {}, () => "/opt/homebrew/bin"],
    ["Intel Homebrew", "darwin", {}, () => "/usr/local/bin"],
    ["Linux package manager", "linux", {}, () => "/usr/bin"],
    ["WinGet links", "win32", { LOCALAPPDATA: "/local-app-data" }, () => "/local-app-data/Microsoft/WinGet/Links"],
  ])("includes the GUI-safe %s directory without relying on inherited PATH", async (
    _label,
    platform,
    additionalEnv,
    directoryForHome,
  ) => {
    const homedir = await makeTemporaryDirectory();
    const context = await createExecutableSearchContext({
      env: { PATH: "", ...additionalEnv },
      homedir,
      platform,
    });

    expect(context.directories.map(({ directory }) => directory))
      .toContain(directoryForHome(homedir));
  });

  it("resolves Windows Node-generated command shims as well as native executables", async () => {
    const commandPath = path.join("/tools", "codex.cmd");
    const fsModule = {
      constants: { X_OK: 1 },
      promises: {
        access: async (filename) => {
          if (filename !== commandPath) throw new Error("missing");
        },
        realpath: async (filename) => {
          if (filename !== commandPath && filename !== "/tools") throw new Error("missing");
          return filename;
        },
        stat: async (filename) => {
          if (filename !== commandPath) throw new Error("missing");
          return {
            dev: 1,
            ino: 2,
            isFile: () => true,
            mtimeMs: 3,
            size: 4,
          };
        },
      },
    };

    await expect(resolveFirstExecutable({
      fsModule,
      names: ["codex"],
      platform: "win32",
      searchContext: {
        directories: [{ directory: "/tools", source: "path-installation" }],
      },
    })).resolves.toMatchObject({
      executablePath: commandPath,
      invokedAs: "codex",
    });
  });

  it("rejects a generic pi executable and continues to verified evidence", async () => {
    const homedir = await makeTemporaryDirectory();
    const genericPi = path.join(homedir, ".volta", "bin", "pi");
    const verifiedPi = path.join(homedir, ".asdf", "shims", "pi");
    await writeExecutable(genericPi, "#!/bin/sh\necho unrelated-math-cli\n");
    await writeExecutable(verifiedPi, "#!/bin/sh\n# pi_coding_agent\n");
    const resolver = createLocalAgentExecutableResolver({
      discoveryPort: createExecutableDiscoveryPort({
        env: { PATH: "" }, homedir, nodePlatform: "darwin",
      }),
    });

    await expect(resolver.resolve("pi")).resolves.toMatchObject({
      status: "found",
      candidate: {
        executablePath: await realpath(verifiedPi),
        invokedAs: "pi",
      },
    });
  });

  it.each([
    ["native installer", "darwin", (home) => path.join(home, ".local", "bin", "claude")],
    ["legacy local installer", "darwin", (home) => path.join(home, ".claude", "local", "claude")],
    ["Windows native installer", "win32", (home) => path.join(home, ".local", "bin", "claude.exe")],
  ])("finds Claude Code from its %s location", async (_label, platform, executableForHome) => {
    const homedir = await makeTemporaryDirectory();
    const executablePath = executableForHome(homedir);
    await writeExecutable(executablePath, "#!/bin/sh\n# claude fixture\n");
    const resolver = createLocalAgentExecutableResolver({
      discoveryPort: createExecutableDiscoveryPort({
        env: { PATH: "" }, homedir, nodePlatform: platform,
      }),
    });

    await expect(resolver.resolve("claude")).resolves.toMatchObject({
      status: "found",
      candidate: { executablePath: await realpath(executablePath) },
    });
  });

  it("finds Claude Code through the Windows WinGet link directory", async () => {
    const homedir = await makeTemporaryDirectory();
    const localAppData = path.join(homedir, "AppData", "Local");
    const executablePath = path.join(localAppData, "Microsoft", "WinGet", "Links", "claude.exe");
    await writeExecutable(executablePath, "#!/bin/sh\n# claude WinGet fixture\n");
    const resolver = createLocalAgentExecutableResolver({
      discoveryPort: createExecutableDiscoveryPort({
        env: { PATH: "", LOCALAPPDATA: localAppData }, homedir, nodePlatform: "win32",
      }),
    });

    await expect(resolver.resolve("claude")).resolves.toMatchObject({
      status: "found",
      candidate: { executablePath: await realpath(executablePath) },
    });
  });

  it.each([
    ["managed installer", (home) => path.join(home, ".pi", "agent", "bin", "pi")],
    ["OMP-compatible managed installer", (home) => path.join(home, ".omp", "agent", "bin", "pi")],
    ["Hermes bundle", (home) => path.join(home, ".hermes", "node", "bin", "pi")],
  ])("finds Pi from its %s location with product identity evidence", async (_label, executableForHome) => {
    const homedir = await makeTemporaryDirectory();
    const executablePath = executableForHome(homedir);
    await writeExecutable(executablePath, "#!/bin/sh\n# managed pi fixture\n");
    const resolver = createLocalAgentExecutableResolver({
      discoveryPort: createExecutableDiscoveryPort({
        env: { PATH: "" }, homedir, nodePlatform: "darwin",
      }),
    });

    await expect(resolver.resolve("pi")).resolves.toMatchObject({
      status: "found",
      candidate: { executablePath: await realpath(executablePath) },
    });
  });

  it.each([
    ["npm global", ".npm-global", "@earendil-works/pi-coding-agent"],
    ["installer user fallback", ".local", "@earendil-works/pi-coding-agent"],
    ["legacy npm global", ".npm-global", "@mariozechner/pi-coding-agent"],
  ])("finds a Pi %s installation with package identity", async (_label, prefixName, packageName) => {
    const homedir = await makeTemporaryDirectory();
    const packageRoot = path.join(homedir, prefixName, "lib", "node_modules", ...packageName.split("/"));
    const executablePath = path.join(packageRoot, "dist", "cli.js");
    const commandPath = path.join(homedir, prefixName, "bin", "pi");
    await writeExecutable(executablePath, "#!/usr/bin/env node\n");
    await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: packageName }), "utf8");
    await mkdir(path.dirname(commandPath), { recursive: true });
    await symlink(path.relative(path.dirname(commandPath), executablePath), commandPath);
    const resolver = createLocalAgentExecutableResolver({
      discoveryPort: createExecutableDiscoveryPort({
        env: { PATH: "" }, homedir, nodePlatform: "darwin",
      }),
    });

    await expect(resolver.resolve("pi")).resolves.toMatchObject({
      status: "found",
      candidate: { executablePath: await realpath(executablePath) },
    });
  });

  it("requires product evidence for Cursor's ambiguous agent basename", async () => {
    const homedir = await makeTemporaryDirectory();
    const executablePath = path.join(homedir, ".volta", "bin", "agent");
    await writeExecutable(executablePath, "#!/bin/sh\necho unrelated-agent\n");
    const inheritedPath = Array.from({ length: 48 }, (_, index) => (
      path.join(homedir, "inherited-path", String(index))
    )).join(":");
    const resolver = createLocalAgentExecutableResolver({
      discoveryPort: createExecutableDiscoveryPort({
        env: { PATH: inheritedPath }, homedir, nodePlatform: "darwin",
      }),
    });

    await expect(resolver.resolve("cursor")).resolves.toMatchObject({
      status: "failed",
      reasonCode: "identity-mismatch",
    });
    await writeFile(executablePath, "#!/bin/sh\n# cursor-agent\n", "utf8");
    await expect(resolver.resolve("cursor")).resolves.toMatchObject({
      status: "found",
      candidate: {
        executablePath: await realpath(executablePath),
        invokedAs: "agent",
      },
    });
  });
});

describe("Local Agent installation refresh with real filesystem changes", () => {
  it("discovers a newly installed Codex immediately even when a non-empty snapshot is cached", async () => {
    const homedir = await makeTemporaryDirectory();
    const localBin = path.join(homedir, ".local", "bin");
    const registry = createLocalAgentInstallationRegistry(
      defaultLocalAgentInstallationRegistry.filter(({ id }) => id === "codex" || id === "claude"),
    );
    const resolver = createLocalAgentExecutableResolver({
      registry,
      discoveryPort: createExecutableDiscoveryPort({
        env: { PATH: "" }, homedir, nodePlatform: "darwin",
      }),
    });
    const service = createLocalAgentInstallationService({
      registry,
      resolver,
      createResolutionContext: async () => Object.freeze({
        executableSearch: Object.freeze({
          directories: Object.freeze([
            Object.freeze({ directory: localBin, source: "user-installation" }),
          ]),
        }),
      }),
    });
    await writeExecutable(path.join(localBin, "claude"), "#!/bin/sh\n# claude fixture\n");

    await expect(service.discover()).resolves.toMatchObject({
      source: "scan",
      availableAgentIds: ["claude"],
    });
    await writeExecutable(path.join(localBin, "codex"), "#!/bin/sh\n# codex fixture\n");
    await expect(service.discover()).resolves.toMatchObject({
      source: "memory-cache",
      availableAgentIds: ["claude"],
    });
    await expect(service.discover({ refresh: true })).resolves.toMatchObject({
      source: "scan",
      availableAgentIds: ["codex", "claude"],
    });
  });
});

describe("Terminal Agent product identity", () => {
  it("accepts an npm-installed Pi binary by bounded ancestor package metadata", async () => {
    const root = await makeTemporaryDirectory();
    const packageRoot = path.join(root, "node_modules", "@earendil-works", "pi-coding-agent");
    const executablePath = path.join(packageRoot, "dist", "pi");
    await writeExecutable(executablePath, "#!/usr/bin/env node\n");
    await writeFile(
      path.join(packageRoot, "package.json"),
      JSON.stringify({ name: "@earendil-works/pi-coding-agent" }),
      "utf8",
    );
    const definition = getLocalAgentInstallationDefinition("pi");

    await expect(verifyLocalAgentCandidateIdentity(definition, {
      executablePath,
      invokedAs: "pi",
    })).resolves.toBe(true);
  });
});

async function makeTemporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "puppyone-agent-resolver-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeExecutable(filename, contents) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, contents, "utf8");
  await chmod(filename, 0o755);
}
