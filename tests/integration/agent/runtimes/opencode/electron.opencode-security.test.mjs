import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildOpenCodeEnvironment } from "../../../../../electron/main/agent/runtimes/puppyone-agent/managed-opencode-discovery.mjs";
import {
  formatAuthorizedProjectInstructions,
  loadAuthorizedProjectInstructions,
} from "../../../../../electron/main/agent/security/authorized-project-instructions.mjs";
import { createOpenCodeSessionPermissions } from "../../../../../electron/main/agent/runtimes/opencode-protocol/opencode-security-policy.mjs";

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true }))));

describe("OpenCode main-process security policy", () => {
  it("drops inherited harness overrides and pins the managed profile", () => {
    const environment = buildOpenCodeEnvironment({
      HOME: "/Users/tester",
      PATH: "/usr/bin",
      OPENAI_API_KEY: "openai-secret",
      OPENCODE_API_KEY: "opencode-provider-secret",
      OPENCODE_AUTH_CONTENT: "attacker-auth",
      OPENCODE_CONFIG_CONTENT: '{"permission":{"*":"allow"}}',
      OPENCODE_PERMISSION: '{"*":"allow"}',
      OPENCODE_SERVER_PASSWORD: "fixed-password",
      PUPPYONE_OPENCODE_BIN: "/tmp/untrusted-opencode",
    }, {
      OPENCODE_DISABLE_PROJECT_CONFIG: "0",
      OPENCODE_PURE: "0",
    }, {
      managedConfigDir: "/managed/puppyone/opencode/config",
      homedir: "/Users/tester",
    });

    expect(environment).toMatchObject({
      OPENAI_API_KEY: "openai-secret",
      OPENCODE_API_KEY: "opencode-provider-secret",
      OPENCODE_CONFIG_DIR: "/managed/puppyone/opencode/config",
      OPENCODE_TEST_HOME: "/managed/puppyone/opencode/home",
      XDG_CONFIG_HOME: "/managed/puppyone/opencode/xdg-config",
      XDG_CACHE_HOME: "/managed/puppyone/opencode/cache",
      XDG_STATE_HOME: "/managed/puppyone/opencode/state",
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_SHARE: "1",
      OPENCODE_PURE: "1",
      OPENCODE_ENABLE_QUESTION_TOOL: "true",
    });
    expect(environment).not.toHaveProperty("OPENCODE_AUTH_CONTENT");
    expect(environment).not.toHaveProperty("OPENCODE_CONFIG_CONTENT");
    expect(environment).not.toHaveProperty("OPENCODE_PERMISSION");
    expect(environment).not.toHaveProperty("OPENCODE_SERVER_PASSWORD");
    expect(environment).not.toHaveProperty("PUPPYONE_OPENCODE_BIN");
    expect(environment.HOME).toBe("/Users/tester");
  });

  it("asks for unknown tools, protects env files and keeps plan edits denied", () => {
    const interactive = createOpenCodeSessionPermissions("build");
    expect(interactive[0]).toEqual({ permission: "*", pattern: "*", action: "ask" });
    expect(interactive).toContainEqual({ permission: "read", pattern: "*", action: "allow" });
    expect(interactive).toContainEqual({ permission: "read", pattern: "*.env", action: "ask" });
    expect(interactive).toContainEqual({ permission: "question", pattern: "*", action: "allow" });
    expect(interactive).not.toContainEqual({ permission: "edit", pattern: "*", action: "allow" });
    expect(createOpenCodeSessionPermissions("plan")[0]).toEqual({
      permission: "*",
      pattern: "*",
      action: "deny",
    });
  });

  it("loads only bounded project instructions inside the canonical workspace", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-opencode-instructions-"));
    roots.push(root);
    await fs.promises.writeFile(path.join(root, "AGENTS.md"), "Keep the architecture layered.\n");
    await fs.promises.writeFile(path.join(root, "CLAUDE.md"), "lower priority\n");
    const instructions = await loadAuthorizedProjectInstructions(root);
    expect(instructions).toMatchObject({ source: "AGENTS.md", text: "Keep the architecture layered.\n" });
    expect(formatAuthorizedProjectInstructions(instructions)).toContain("PuppyOne main process authorized");
  });

  it("rejects a project-instruction symlink that escapes the workspace", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-opencode-workspace-"));
    const outside = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-opencode-outside-"));
    roots.push(root, outside);
    await fs.promises.writeFile(path.join(outside, "AGENTS.md"), "outside\n");
    await fs.promises.symlink(path.join(outside, "AGENTS.md"), path.join(root, "AGENTS.md"));
    await expect(loadAuthorizedProjectInstructions(root)).rejects.toThrow(/outside the authorized workspace/i);
  });
});
