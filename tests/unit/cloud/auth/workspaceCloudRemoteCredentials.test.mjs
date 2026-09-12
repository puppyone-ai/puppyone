import { describe, expect, it, vi } from "vitest";
import { createWorkspaceCloudRemoteActions } from "../../../../local-api/git/cloud-remote.mjs";

function harness({ failVerification = false, configuredHelpers = "" } = {}) {
  const calls = [];
  let remoteUrl = null;
  const execGit = vi.fn(async (_root, args, options = {}) => {
    calls.push({ args: [...args], input: options.input ?? null });
    const command = args.join(" ");
    if (command === "rev-parse --is-inside-work-tree") return { stdout: "true\n" };
    if (command === "remote get-url puppyone") {
      if (!remoteUrl) throw new Error("missing remote");
      return { stdout: `${remoteUrl}\n` };
    }
    if (command === "config --get-all credential.helper") return { stdout: configuredHelpers };
    if (args[0] === "remote" && args[1] === "add") {
      remoteUrl = args[3];
      return { stdout: "" };
    }
    if (args[0] === "remote" && args[1] === "set-url") {
      remoteUrl = args[3];
      return { stdout: "" };
    }
    if (command === "remote remove puppyone") {
      remoteUrl = null;
      return { stdout: "" };
    }
    if (args[0] === "ls-remote" && failVerification) {
      throw new Error("authentication failed");
    }
    return { stdout: "" };
  });
  const actions = createWorkspaceCloudRemoteActions({
    execGit,
    getGitErrorOutput: (error) => error.message,
    getWorkspaceGitStatus: async () => ({ isRepo: true, remotes: [] }),
    mutationTimeoutMs: 1000,
    normalizeGitRemoteName: (name) => name,
    normalizeGitRemoteUrl: (url) => url,
    resolveWorkspacePath: (root) => root,
    platform: "darwin",
  });
  return { actions, calls, getRemoteUrl: () => remoteUrl };
}

describe("workspace Cloud Git credential storage", () => {
  it("passes the secret only over git credential approve stdin", async () => {
    const { actions, calls, getRemoteUrl } = harness();
    const secret = "pwg_super_secret_value";
    const url = "https://cloud.example/git/project-1.git";

    await actions.configureWorkspaceCloudRemote(
      "/workspace",
      url,
      "puppyone",
      secret,
      "x-puppyone-token",
    );

    expect(getRemoteUrl()).toBe(url);
    expect(calls.some(({ args }) => args.join(" ").includes(secret))).toBe(false);
    const approval = calls.find(({ args }) => args.join(" ") === "credential approve");
    expect(approval.input).toContain(`password=${secret}`);
    expect(approval.input).toContain("path=git/project-1.git");
    expect(calls.some(({ args }) => args.join(" ") === "ls-remote https://cloud.example/git/project-1.git"))
      .toBe(true);
  });

  it("rejects the credential and restores the prior remote state when verification fails", async () => {
    const { actions, calls, getRemoteUrl } = harness({ failVerification: true });

    await expect(actions.configureWorkspaceCloudRemote(
      "/workspace",
      "https://cloud.example/git/project-1/scopes/scope-1.git",
      "puppyone",
      "pwg_rejected_secret",
    )).rejects.toThrow(/authentication failed/i);

    expect(getRemoteUrl()).toBeNull();
    expect(calls.some(({ args }) => args.join(" ") === "credential reject")).toBe(true);
    expect(calls.some(({ args }) => args.join(" ") === "remote remove puppyone")).toBe(true);
  });

  it("resets an inherited plaintext helper before approving the credential", async () => {
    const { actions, calls } = harness({
      configuredHelpers: "store\nosxkeychain\n",
    });

    await actions.configureWorkspaceCloudRemote(
      "/workspace",
      "https://cloud.example/git/project-1.git",
      "puppyone",
      "pwg_secure_only",
    );

    const commands = calls.map(({ args }) => args);
    expect(commands).toContainEqual([
      "config", "--local", "--add", "credential.helper", "",
    ]);
    expect(commands).toContainEqual([
      "config", "--local", "--add", "credential.helper", "osxkeychain",
    ]);
    const resetIndex = commands.findIndex((args) => (
      args.join(" ") === "config --local --add credential.helper "
    ));
    const approveIndex = commands.findIndex((args) => args.join(" ") === "credential approve");
    expect(resetIndex).toBeGreaterThanOrEqual(0);
    expect(resetIndex).toBeLessThan(approveIndex);
  });
});
