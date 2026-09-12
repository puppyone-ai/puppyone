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
} from "../../../../electron/main/local-executable-resolver.mjs";
import { createTerminalAgentCandidateResolver } from "../../../../electron/main/terminal-agent/terminal-agent-candidate-resolver.mjs";
import { createTerminalAgentCatalog } from "../../../../electron/main/terminal-agent/terminal-agent-catalog.mjs";
import { verifyTerminalAgentCandidateIdentity } from "../../../../electron/main/terminal-agent/terminal-agent-identity.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe("local executable search context", () => {
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
    const resolver = createTerminalAgentCandidateResolver({
      env: { PATH: "" },
      homedir,
      platform: "darwin",
    });
    const pi = createTerminalAgentCatalog().find(({ id }) => id === "pi");

    await expect(resolver.resolve(pi)).resolves.toMatchObject({
      executablePath: await realpath(verifiedPi),
      invokedAs: "pi",
    });
  });

  it("requires product evidence for Cursor's ambiguous agent basename", async () => {
    const homedir = await makeTemporaryDirectory();
    const executablePath = path.join(homedir, ".volta", "bin", "agent");
    await writeExecutable(executablePath, "#!/bin/sh\necho unrelated-agent\n");
    const inheritedPath = Array.from({ length: 48 }, (_, index) => (
      path.join(homedir, "inherited-path", String(index))
    )).join(":");
    const resolver = createTerminalAgentCandidateResolver({
      env: { PATH: inheritedPath },
      homedir,
      platform: "darwin",
    });
    const cursor = createTerminalAgentCatalog().find(({ id }) => id === "cursor");

    await expect(resolver.resolve(cursor)).resolves.toBeNull();
    await writeFile(executablePath, "#!/bin/sh\n# cursor-agent\n", "utf8");
    await expect(resolver.resolve(cursor)).resolves.toMatchObject({
      executablePath: await realpath(executablePath),
      invokedAs: "agent",
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
    const definition = createTerminalAgentCatalog().find(({ id }) => id === "pi");

    await expect(verifyTerminalAgentCandidateIdentity(definition, {
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
