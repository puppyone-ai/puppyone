import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyMacosBuilderConfig } from "../../../../scripts/desktop/build/platforms/macos.mjs";
import {
  FORWARD_EXIT,
  OPENER_BUNDLE_ID,
  appleScriptString,
  createOpenerInfo,
  createOpenerScript,
  forwardFile,
} from "../../../../scripts/desktop/dev/open-with.mjs";

const identity = {
  applicationName: "PuppyOne",
  platformBuildNumber: "1",
  release: { baseVersion: "1.0.0", channel: "stable" },
};
const packagedTypes = applyMacosBuilderConfig({ config: {}, baseBuild: {}, identity }).mac.extendInfo.CFBundleDocumentTypes;

const temporaryDirectories = [];
function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "puppyone-open-with-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function fakeApp({ lockGranted }) {
  return {
    setPath: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => lockGranted),
    releaseSingleInstanceLock: vi.fn(),
  };
}

describe("dev Open With app", () => {
  it("offers exactly the packaged build's file types instead of every file", () => {
    const droplet = {
      CFBundleExecutable: "droplet",
      CFBundleIdentifier: "T",
      CFBundleIconName: "droplet",
      CFBundleDocumentTypes: [{ CFBundleTypeExtensions: ["*"], CFBundleTypeOSTypes: ["****"], CFBundleTypeRole: "Viewer" }],
    };
    const info = createOpenerInfo(droplet);

    expect(info.CFBundleDocumentTypes).toEqual(packagedTypes);
    expect(info.CFBundleIdentifier).toBe(OPENER_BUNDLE_ID);
    expect(info.CFBundleExecutable).toBe("droplet");
    // An asset catalog icon would win over the dev icon.
    expect(info.CFBundleIconName).toBeUndefined();
  });

  it("quotes paths for AppleScript", () => {
    expect(appleScriptString(String.raw`/a "b"\c`)).toBe(String.raw`"/a \"b\"\\c"`);
  });

  it.runIf(process.platform === "darwin")("passes awkward paths through to the forwarder intact", () => {
    const root = temporaryDirectory();
    const tools = path.join(root, `My "Tools" \\ dir`);
    fs.mkdirSync(tools);
    const electronPath = path.join(tools, "electron");
    const record = path.join(root, "arguments.txt");
    fs.writeFileSync(electronPath, `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(record)}\n`, { mode: 0o755 });
    const forwarderPath = path.join(tools, "forwarder's.mjs");
    const file = path.join(root, "notes it's \"here\".md");
    fs.writeFileSync(file, "# Notes\n");

    const scriptPath = path.join(root, "opener.scpt");
    const sourcePath = path.join(root, "opener.applescript");
    fs.writeFileSync(sourcePath, createOpenerScript({ electronPath, forwarderPath }));
    execFileSync("/usr/bin/osacompile", ["-o", scriptPath, sourcePath]);
    execFileSync("/usr/bin/osascript", [
      "-e", `set opener to load script POSIX file ${appleScriptString(scriptPath)}`,
      "-e", `tell opener to open {POSIX file ${appleScriptString(file)}}`,
    ]);

    expect(fs.readFileSync(record, "utf8")).toBe(`${forwarderPath}\n${file}\n`);
  });

  it("hands the file to the running dev instance", () => {
    const directory = temporaryDirectory();
    const file = path.join(directory, "notes.md");
    fs.writeFileSync(file, "# Notes\n");
    const app = fakeApp({ lockGranted: false });

    const result = forwardFile({ app, argv: ["electron", "forwarder.mjs", file], workingDirectory: directory, userDataPath: "/dev-data" });

    expect(result).toBe(FORWARD_EXIT.delivered);
    expect(app.setPath).toHaveBeenCalledWith("userData", "/dev-data");
    expect(app.requestSingleInstanceLock).toHaveBeenCalledWith(expect.objectContaining({ filePath: file }));
  });

  it("reports a missing dev instance and gives the lock back", () => {
    const directory = temporaryDirectory();
    const file = path.join(directory, "notes.md");
    fs.writeFileSync(file, "# Notes\n");
    const app = fakeApp({ lockGranted: true });

    expect(forwardFile({ app, argv: ["electron", "forwarder.mjs", file], workingDirectory: directory, userDataPath: "/dev-data" }))
      .toBe(FORWARD_EXIT.devNotRunning);
    expect(app.releaseSingleInstanceLock).toHaveBeenCalledOnce();
  });

  it("does not touch the lock without a file", () => {
    const app = fakeApp({ lockGranted: false });

    expect(forwardFile({ app, argv: ["electron", "forwarder.mjs"], workingDirectory: os.tmpdir(), userDataPath: "/dev-data" }))
      .toBe(FORWARD_EXIT.noFile);
    expect(app.requestSingleInstanceLock).not.toHaveBeenCalled();
  });
});
