import { describe, expect, it, vi } from "vitest";
import { createCompanionAppPort } from "../../../../electron/main/platform/macos/companion-apps.mjs";
import { companionIdentities } from "../../../../electron/main/local-agent-installation/setup/setup-registry.mjs";

function portFixture({ metadata = { CFBundleIdentifier: "com.openai.codex", CFBundleExecutable: "Codex" }, executable = true } = {}) {
  const fsModule = {
    opendir: vi.fn(async () => (async function* () { yield { name: "Renamed.app", isDirectory: () => true }; })()),
    stat: vi.fn(async (file) => ({ size: 1_024, isFile: () => file.endsWith("Info.plist") || executable })),
    access: vi.fn(async () => {}),
  };
  const readMetadata = vi.fn(async () => metadata);
  return { fsModule, readMetadata, port: createCompanionAppPort({ nodePlatform: "darwin", roots: ["/fixture"], fsModule, readMetadata }) };
}
describe("bounded macOS companion presence", () => {
  it("recognizes a renamed app by bundle identity and actual executable, returning no path", async () => {
    const h = portFixture(); const result = await h.port.inspect(companionIdentities);
    expect(result).toEqual([{ companionId: "codex", status: "present" }, { companionId: "cursor", status: "not-found" }]);
    expect(h.fsModule.access).toHaveBeenCalledWith("/fixture/Renamed.app/Contents/MacOS/Codex", 1);
    expect(JSON.stringify(result)).not.toContain("fixture");
  });
  it.each([
    { metadata: { CFBundleIdentifier: "com.openai.chat", CFBundleExecutable: "ChatGPT" } },
    { executable: false },
    { metadata: { CFBundleIdentifier: "com.openai.codex", CFBundleExecutable: "../../bin/sh" } },
  ])("rejects unrelated identity, missing executable and traversal: %j", async (options) => {
    expect((await portFixture(options).port.inspect(companionIdentities)).some(({ status }) => status === "present")).toBe(false);
  });
  it("reports unsupported platforms without touching the filesystem", async () => {
    const fsModule = { opendir: vi.fn() };
    const port = createCompanionAppPort({ nodePlatform: "linux", fsModule });
    expect((await port.inspect(companionIdentities)).every(({ status }) => status === "unsupported")).toBe(true);
    expect(fsModule.opendir).not.toHaveBeenCalled();
  });
  it("turns denied reads into unknown, never an installation recommendation", async () => {
    const h = portFixture(); h.fsModule.opendir.mockRejectedValue(Object.assign(new Error("private"), { code: "EACCES" }));
    expect((await h.port.inspect(companionIdentities)).every(({ status }) => status === "unknown")).toBe(true);
  });
  it("retains timed-out IO capacity until the underlying operation finishes", async () => {
    let resolve; const stuck = new Promise((done) => { resolve = done; });
    const fsModule = { opendir: vi.fn(() => stuck) };
    const port = createCompanionAppPort({ nodePlatform: "darwin", roots: ["/fixture"], fsModule, timeoutMs: 5 });
    await port.inspect(companionIdentities); await port.inspect(companionIdentities); await port.inspect(companionIdentities);
    expect(fsModule.opendir).toHaveBeenCalledTimes(2);
    resolve((async function* () {})());
  });
});
