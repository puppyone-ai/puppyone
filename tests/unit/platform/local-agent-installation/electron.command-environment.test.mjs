import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { runBoundedProcessProbe } from "../../../../electron/main/platform/common/bounded-process-probe.mjs";
import { readUserCommandEnvironment } from "../../../../electron/main/platform/common/command-environment.mjs";
import { resolveProcessInvocation } from "../../../../electron/main/platform/windows/process-invocation.mjs";
import { discoveryIoPolicy, runDiscoveryIo } from "../../../../electron/main/platform/common/discovery-io-budget.mjs";

function environmentOutput(args, entries, { noise = "PATH=/wrong\n", code = 0 } = {}) {
  const command = args.at(-1);
  const begin = command.match(/puppyone-env-[a-f0-9-]+-begin/u)[0];
  const end = command.match(/puppyone-env-[a-f0-9-]+-end/u)[0];
  return { code, stderr: "", stdout: `${noise}\0${begin}\0${entries.join("\0")}\0\0${end}\0exit noise` };
}

describe("platform command environment", () => {
  it("preserves Unicode installation paths split across stdout chunks", async () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();
    const result = runBoundedProcessProbe("/bin/fixture", [], { spawn: () => child });
    const bytes = Buffer.from("PATH=/工具/命令/bin\0");
    for (const byte of bytes) child.stdout.write(Buffer.from([byte]));
    child.emit("close", 0, null);
    await expect(result).resolves.toMatchObject({ stdout: "PATH=/工具/命令/bin\0" });
  });
  it.each(["bash", "zsh", "fish"])("loads %s once using a neutral cwd and parses framed data only", async (shell) => {
    const runProbe = vi.fn(async (_file, args) => environmentOutput(args, [
      "PATH=/custom/node:/usr/bin", "PROFILE_VALUE=first\nsecond=third", "INVALID-KEY=no",
      "PUPPYONE_RESOLVING_ENVIRONMENT=1", "DISABLE_AUTO_UPDATE=true",
    ]));
    const snapshot = await readUserCommandEnvironment({
      env: { SHELL: `/bin/${shell}`, PATH: "/old" }, homedir: "/fixture/home", platform: "linux", runProbe,
    });
    expect(snapshot).toMatchObject({ complete: true, source: "shell-environment", environment: {
      PATH: "/custom/node:/usr/bin", PROFILE_VALUE: "first\nsecond=third",
    } });
    expect(snapshot.environment["INVALID-KEY"]).toBeUndefined();
    expect(snapshot.environment.PUPPYONE_RESOLVING_ENVIRONMENT).toBeUndefined();
    expect(snapshot.environment.DISABLE_AUTO_UPDATE).toBeUndefined();
    expect(runProbe).toHaveBeenCalledOnce();
    expect(runProbe.mock.calls[0][2]).toMatchObject({ cwd: "/fixture/home", timeoutMs: 4000, maxOutputBytes: 262144 });
    expect(runProbe.mock.calls[0][1][0]).toBe(shell === "fish" ? "--login" : "-ilc");
  });

  it.each(["timeout", "missing-marker", "nonzero-exit"])("reports %s as incomplete and retries on the next read", async (failure) => {
    const runProbe = vi.fn().mockImplementationOnce(async (_file, args) => {
      if (failure === "timeout") throw new Error("timed out with private details");
      if (failure === "missing-marker") return { code: 0, stdout: "PATH=/misleading", stderr: "" };
      return environmentOutput(args, ["PATH=/custom"], { code: 1 });
    }).mockImplementation(async (_file, args) => environmentOutput(args, ["PATH=/new"]));
    const options = { env: { SHELL: "/bin/zsh", PATH: "/old" }, platform: "darwin", runProbe };
    await expect(readUserCommandEnvironment(options)).resolves.toMatchObject({
      complete: false, reasonCode: "environment-unavailable", environment: { PATH: "/old" },
    });
    await expect(readUserCommandEnvironment(options)).resolves.toMatchObject({ complete: true, environment: { PATH: "/new" } });
  });

  it("does not turn cancellation into a successful fallback", async () => {
    const controller = new AbortController();
    const runProbe = vi.fn(async () => { controller.abort(); throw new Error("cancelled"); });
    await expect(readUserCommandEnvironment({ env: { SHELL: "/bin/zsh" }, signal: controller.signal, runProbe }))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it("uses the Linux shell policy when SHELL is absent", async () => {
    const runProbe = vi.fn(async (_file, args) => environmentOutput(args, ["PATH=/usr/bin"]));
    await readUserCommandEnvironment({ env: {}, platform: "linux", runProbe });
    expect(runProbe.mock.calls[0][0]).toBe("/bin/bash");
  });

  it("refreshes Windows persistent PATH without retaining a competing Path key", async () => {
    const runProbe = vi.fn().mockResolvedValueOnce({ code: 0, stdout: JSON.stringify({ PATH: "C:\\first", PATHEXT: ".CMD;.EXE" }) })
      .mockResolvedValueOnce({ code: 0, stdout: JSON.stringify({ PATH: "C:\\new;C:\\first", PATHEXT: ".EXE;.CMD" }) });
    const options = { env: { SystemRoot: "C:\\Windows", Path: "C:\\old", CUSTOM_SETTING: "preserved" }, platform: "win32", runProbe };
    const first = await readUserCommandEnvironment(options);
    const next = await readUserCommandEnvironment(options);
    expect(first.environment.PATH).toBe("C:\\first");
    expect(next.environment).toMatchObject({ PATH: "C:\\new;C:\\first", CUSTOM_SETTING: "preserved" });
    expect(next.environment.Path).toBeUndefined();
    expect(runProbe.mock.calls[0][1]).toContain("-NoProfile");
    expect(runProbe.mock.calls[0][1].at(-1)).toContain("GetEnvironmentVariables('User')");
  });
});

describe("Windows CLI entrypoint invocation", () => {
  it("launches an npm .cmd through cmd.exe with quoted paths and delayed expansion disabled", () => {
    const plan = resolveProcessInvocation("C:\\CLI tools\\codex.cmd", ["--version"], { platform: "win32", env: { SystemRoot: "C:\\Windows" } });
    expect(plan).toEqual({ file: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/v:off", "/c", '""C:\\CLI tools\\codex.cmd" "--version""'],
      options: { windowsVerbatimArguments: true } });
  });
  it("preserves native argv without a shell", () => {
    expect(resolveProcessInvocation("C:\\tools\\codex.exe", ["a b"], { platform: "win32" }))
      .toEqual({ file: "C:\\tools\\codex.exe", args: ["a b"], options: {} });
  });
  it.each(['C:\\%expanded%\\codex.cmd', 'C:\\bad"path\\codex.cmd'])("rejects batch paths that cmd cannot preserve: %s", (file) => {
    expect(() => resolveProcessInvocation(file, [], { platform: "win32" })).toThrow("cannot preserve");
  });
});

describe("discovery filesystem budget", () => {
  it("keeps timed-out work in the concurrency budget and releases capacity only on actual completion", async () => {
    vi.useFakeTimers();
    const finish = [];
    try {
      const tasks = Array.from({ length: discoveryIoPolicy.maxPendingTasks }, () => runDiscoveryIo(
        () => new Promise((resolve) => finish.push(resolve)), { timeoutMs: 10 },
      ).catch((error) => error.code));
      await vi.advanceTimersByTimeAsync(11);
      expect(await Promise.all(tasks)).toEqual(Array(discoveryIoPolicy.maxPendingTasks).fill("filesystem-timeout"));
      await expect(runDiscoveryIo(() => 1)).rejects.toMatchObject({ code: "filesystem-busy" });
      finish.forEach((resolve) => resolve());
      await Promise.resolve();
      await Promise.resolve();
      await expect(runDiscoveryIo(() => "recovered")).resolves.toBe("recovered");
    } finally {
      finish.forEach((resolve) => resolve());
      vi.useRealTimers();
    }
  });
});
