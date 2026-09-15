import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
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
import { getLocalAgentInstallationDefinition } from "../../../../electron/main/local-agent-installation/installation-registry.mjs";
import { verifyLocalAgentCandidateIdentity } from "../../../../electron/main/local-agent-installation/candidate-identity.mjs";

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
