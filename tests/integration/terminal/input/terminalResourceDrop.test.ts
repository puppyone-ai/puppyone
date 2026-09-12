/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { quoteTerminalPaths, resolveTerminalDropPaths } from "../../../../src/features/desktop-terminal/interactions/terminalResourceDrop";
import { execFileSync } from "node:child_process";

afterEach(() => { delete window.puppyoneDesktop; });
describe("Terminal resource path delivery", () => {
  it.skipIf(process.platform === "win32")("round-trips literal spaces, Chinese, quotes and shell metacharacters without executing them", () => {
    const paths = ["/repo/中文 file.md", "/repo/it's.md", "/repo/$(echo injected)`echo nope`;$HOME.md"];
    const quoted = quoteTerminalPaths(paths, "/bin/zsh");
    const actual = execFileSync("/bin/sh", ["-c", `printf '%s\\0' ${quoted}`]);
    expect(actual.toString().split("\0").slice(0, -1)).toEqual(paths);
    expect(quoted).not.toContain("\n");
  });
  it("rejects terminal controls and unknown shell semantics", () => {
    for (const path of ["/repo/a\nb", "/repo/\u001b[31m", "/repo/\u009b31m"]) expect(() => quoteTerminalPaths([path], "zsh")).toThrow();
    expect(() => quoteTerminalPaths(["/repo/file"], "unknown")).toThrow();
    expect(quoteTerminalPaths(["C:\\my files\\it's.md"], "pwsh.exe")).toBe("'C:\\my files\\it''s.md'");
  });
  it("resolves identities through Main instead of concatenating the receiving root", async () => {
    const resolve = vi.fn(async () => [{ absolutePath: "/repo-b/README.md" }]);
    window.puppyoneDesktop = { resolveResourceReferences: resolve } as unknown as NonNullable<typeof window.puppyoneDesktop>;
    const resource = "puppyone-local://workspace/repo-b/README.md";
    await expect(resolveTerminalDropPaths({ kind: "workspace-entries", workspaceId: "window", typed: true, entries: [{ path: resource, name: "README.md", entryType: "file" }] }, "/repo-a")).resolves.toEqual(["/repo-b/README.md"]);
    expect(resolve).toHaveBeenCalledWith({ resources: [resource], rootPath: "/repo-a" });
  });
  it("claims native workbench files as references and does not bypass a rejected session", async () => {
    const file = new File([""], "README.md");
    const resource = "puppyone-local://workspace/repo-b/README.md";
    const claim = vi.fn(async () => ({ entries: [{ path: resource, name: "README.md", entryType: "file" }] }));
    const resolve = vi.fn(async () => [{ absolutePath: "/repo-b/README.md" }]);
    const rawPath = vi.fn(() => "/untrusted/README.md");
    window.puppyoneDesktop = { claimResourceDrop: claim, resolveResourceReferences: resolve, getPathForFile: rawPath } as unknown as NonNullable<typeof window.puppyoneDesktop>;
    const source = { kind: "files" as const, files: [file] };
    await expect(resolveTerminalDropPaths(source, "/repo-a")).resolves.toEqual(["/repo-b/README.md"]);
    expect(rawPath).not.toHaveBeenCalled();
    expect(claim).toHaveBeenCalledWith({ files: [file], intent: "terminal-path", targetResource: undefined });
    claim.mockRejectedValueOnce(new Error("expired"));
    await expect(resolveTerminalDropPaths(source, "/repo-a")).rejects.toThrow("expired");
    expect(rawPath).not.toHaveBeenCalled();
  });

});
