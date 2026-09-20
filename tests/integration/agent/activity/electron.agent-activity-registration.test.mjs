import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwnedJsonHookConfig } from "../../../../electron/main/terminal-agent/activity/registration/owned-config-mutation.mjs";
import { createOwnedCursorCliHookConfig } from "../../../../electron/main/terminal-agent/activity/registration/cursor-cli-hook-config.mjs";
import {
  createAgentActivityBridgeInstaller,
  createBridgeCommand,
} from "../../../../electron/main/terminal-agent/activity/registration/bridge-installer.mjs";
import { createHookRegistrationService } from "../../../../electron/main/terminal-agent/activity/registration/hook-registration-service.mjs";

const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("owned Agent activity Hook registration", () => {
  it("keeps every Hook off in a fresh profile until the user explicitly enables one", async () => {
    const homedir = await temporaryDirectory();
    const install = vi.fn(async () => undefined);
    const isCurrent = vi.fn(async () => true);
    const ensureCurrent = vi.fn(async () => undefined);
    const createService = () => createHookRegistrationService({
      homedir,
      bridgeInstaller: {
        command: "puppyone-agent-hook.mjs",
        install,
        isCurrent,
        ensureCurrent,
      },
    });
    const service = createService();

    const initial = await service.getSnapshot();
    expect(initial.providers.filter(({ configurable }) => configurable))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ providerId: "codex", enrollment: "not-configured" }),
        expect.objectContaining({ providerId: "claude", enrollment: "not-configured" }),
        expect.objectContaining({ providerId: "cursor", enrollment: "not-configured" }),
      ]));
    expect(initial.providers.filter(({ configurable }) => !configurable)
      .every(({ enrollment }) => enrollment === "basic-only")).toBe(true);
    await expect(service.hasAnyEnabled()).resolves.toBe(false);
    expect(install).not.toHaveBeenCalled();
    expect(isCurrent).not.toHaveBeenCalled();
    expect(ensureCurrent).not.toHaveBeenCalled();
    await expect(readFile(path.join(homedir, ".codex", "hooks.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(homedir, ".claude", "settings.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(homedir, ".cursor", "hooks.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });

    await expect(service.setEnabled("codex", true)).resolves.toMatchObject({ enrollment: "enabled" });
    expect(install).toHaveBeenCalledOnce();

    const reopened = await createService().getSnapshot();
    expect(reopened.providers.find(({ providerId }) => providerId === "codex"))
      .toMatchObject({ enrollment: "enabled" });
    expect(reopened.providers.find(({ providerId }) => providerId === "claude"))
      .toMatchObject({ enrollment: "not-configured" });
    expect(reopened.providers.find(({ providerId }) => providerId === "cursor"))
      .toMatchObject({ enrollment: "not-configured" });
  });

  it("merges and removes only Puppyone-owned Codex handlers", async () => {
    const directory = await temporaryDirectory();
    const configPath = path.join(directory, "hooks.json");
    await writeFile(configPath, JSON.stringify({
      description: "user config",
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "user-hook" }] }],
      },
    }));
    const registration = createOwnedJsonHookConfig({
      configPath,
      providerId: "codex",
      command: "puppyone-agent-hook.mjs",
    });
    await expect(registration.inspect()).resolves.toMatchObject({ enrollment: "not-configured" });
    await expect(registration.enable()).resolves.toMatchObject({ enrollment: "enabled" });
    const enabled = JSON.parse(await readFile(configPath, "utf8"));
    expect(enabled.description).toBe("user config");
    expect(JSON.stringify(enabled)).toContain("user-hook");
    expect(JSON.stringify(enabled).match(/puppyone-agent-hook\.mjs/gu)).toHaveLength(3);
    await registration.enable();
    expect((await readFile(configPath, "utf8")).match(/puppyone-agent-hook\.mjs/gu)).toHaveLength(3);
    await expect(registration.disable()).resolves.toMatchObject({ enrollment: "not-configured" });
    expect(await readFile(configPath, "utf8")).toContain("user-hook");
  });

  it("preserves a user-edited owned entry and reports repair", async () => {
    const directory = await temporaryDirectory();
    const configPath = path.join(directory, "settings.json");
    await writeFile(configPath, JSON.stringify({
      hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "old/puppyone-agent-hook.mjs" }] }] },
    }));
    const registration = createOwnedJsonHookConfig({
      configPath,
      providerId: "claude",
      command: "new/puppyone-agent-hook.mjs",
    });
    await expect(registration.inspect()).resolves.toMatchObject({ enrollment: "needs-repair" });
    await expect(registration.enable()).rejects.toThrow("AGENT_ACTIVITY_CONFIG_CONFLICT");
    expect(await readFile(configPath, "utf8")).toContain("old/puppyone-agent-hook.mjs");
  });

  it("merges idempotent Cursor CLI handlers without changing user Hooks", async () => {
    const directory = await temporaryDirectory();
    const configPath = path.join(directory, ".cursor", "hooks.json");
    await writeFileAfterMkdir(configPath, JSON.stringify({
      version: 1,
      note: "keep me",
      hooks: {
        preToolUse: [{ command: "user-hook", matcher: "Shell" }],
        stop: [{ command: "user-stop-hook" }],
      },
    }));
    const registration = createOwnedCursorCliHookConfig({
      configPath,
      command: "puppyone-agent-hook.mjs --provider cursor",
    });

    await expect(registration.inspect()).resolves.toMatchObject({ enrollment: "not-configured" });
    await expect(registration.enable()).resolves.toMatchObject({ enrollment: "enabled" });
    await registration.enable();

    const enabledSource = await readFile(configPath, "utf8");
    const enabled = JSON.parse(enabledSource);
    expect(enabled.note).toBe("keep me");
    expect(enabled.hooks.preToolUse[0]).toEqual({ command: "user-hook", matcher: "Shell" });
    expect(enabled.hooks.stop).toEqual([{ command: "user-stop-hook" }]);
    expect(enabledSource.match(/puppyone-agent-hook\.mjs/gu)).toHaveLength(4);
    expect(enabled.hooks.preToolUse[1]).toMatchObject({
      type: "command",
      matcher: "Read|Write|Grep|Delete",
      timeout: 2,
    });
    expect(enabled.hooks.sessionEnd[0]).not.toHaveProperty("matcher");

    await expect(registration.disable()).resolves.toMatchObject({ enrollment: "not-configured" });
    const disabled = JSON.parse(await readFile(configPath, "utf8"));
    expect(disabled.note).toBe("keep me");
    expect(disabled.hooks).toEqual({
      preToolUse: [{ command: "user-hook", matcher: "Shell" }],
      stop: [{ command: "user-stop-hook" }],
    });
  });

  it("refuses to overwrite a modified Cursor CLI handler or unknown config version", async () => {
    const directory = await temporaryDirectory();
    const configPath = path.join(directory, "hooks.json");
    await writeFile(configPath, JSON.stringify({
      version: 1,
      hooks: {
        preToolUse: [{
          type: "command",
          command: "old/puppyone-agent-hook.mjs --provider cursor",
          matcher: "Read|Write",
          timeout: 9,
        }],
      },
    }));
    const registration = createOwnedCursorCliHookConfig({
      configPath,
      command: "new/puppyone-agent-hook.mjs --provider cursor",
    });
    await expect(registration.inspect()).resolves.toMatchObject({
      enrollment: "needs-repair",
      reason: "owned-entry-changed",
    });
    await expect(registration.enable()).rejects.toThrow("AGENT_ACTIVITY_CONFIG_CONFLICT");

    await writeFile(configPath, JSON.stringify({ version: 2, hooks: {} }));
    await expect(registration.inspect()).resolves.toMatchObject({
      enrollment: "needs-repair",
      reason: "unsupported-version",
    });
    await expect(registration.enable()).rejects.toThrow("AGENT_ACTIVITY_CURSOR_CONFIG_UNSUPPORTED_VERSION");
  });

  it("exposes Cursor CLI as configurable through the batch registration service", async () => {
    const homedir = await temporaryDirectory();
    const install = vi.fn(async () => undefined);
    const ensureCurrent = vi.fn(async () => undefined);
    const service = createHookRegistrationService({
      homedir,
      bridgeInstaller: {
        command: "puppyone-agent-hook.mjs",
        install,
        isCurrent: async () => true,
        ensureCurrent,
      },
    });

    await expect(service.getSnapshot()).resolves.toMatchObject({
      providers: expect.arrayContaining([
        expect.objectContaining({
          providerId: "cursor",
          displayName: "Cursor Agent CLI",
          configurable: true,
          enrollment: "not-configured",
        }),
      ]),
    });
    await expect(service.setEnabled("cursor", true)).resolves.toMatchObject({ enrollment: "enabled" });
    expect(install).toHaveBeenCalledOnce();
    expect(await readFile(path.join(homedir, ".cursor", "hooks.json"), "utf8"))
      .toContain("--provider cursor");
    await expect(service.isEnabled("cursor")).resolves.toBe(true);
    expect(ensureCurrent).toHaveBeenCalledOnce();
  });

  it("repairs an outdated installed bridge before an enrolled Agent session starts", async () => {
    const directory = await temporaryDirectory();
    const sourceDirectory = path.join(directory, "source");
    const userDataPath = path.join(directory, "user-data");
    await mkdir(sourceDirectory);
    const bridgeSources = {
      "puppyone-agent-hook.mjs": "export const bridge = 'current';\n",
      "payload-projector.mjs": "export const projector = 'current';\n",
      "shell-file-intent.mjs": "export const shell = 'current';\n",
    };
    await Promise.all(Object.entries(bridgeSources).map(([fileName, source]) => (
      writeFile(path.join(sourceDirectory, fileName), source)
    )));
    const installer = createAgentActivityBridgeInstaller({
      sourceDirectory,
      userDataPath,
      executablePath: "/Applications/PuppyOne",
    });
    await installer.install();
    const installedProjector = path.join(
      userDataPath,
      "agent-activity",
      "bridge",
      "current",
      "payload-projector.mjs",
    );
    await writeFile(installedProjector, "export const projector = 'old';\n");
    await expect(installer.isCurrent()).resolves.toBe(false);

    await installer.ensureCurrent();

    await expect(installer.isCurrent()).resolves.toBe(true);
    await expect(readFile(installedProjector, "utf8"))
      .resolves.toBe(bridgeSources["payload-projector.mjs"]);
  });

  it("creates an Electron-as-Node bridge command without shell interpolation", () => {
    expect(createBridgeCommand({
      bridgePath: "/tmp/Puppy One/puppyone-agent-hook.mjs",
      executablePath: "/Applications/Puppy One.app/Contents/MacOS/Puppy One",
      platform: "darwin",
    })).toBe("/usr/bin/env ELECTRON_RUN_AS_NODE=1 '/Applications/Puppy One.app/Contents/MacOS/Puppy One' '/tmp/Puppy One/puppyone-agent-hook.mjs'");
  });
});

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "puppyone-hook-registration-"));
  directories.push(directory);
  return directory;
}

async function writeFileAfterMkdir(filePath, source) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, source);
}
