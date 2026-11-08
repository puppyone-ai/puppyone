import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { applyMacosBuilderConfig } from "../../../../scripts/desktop/build/platforms/macos.mjs";
import {
  DEV_NOT_RUNNING_MESSAGE,
  OPENER_BUNDLE_ID,
  appleScriptString,
  createOpenerInfo,
  createOpenerScript,
  devControlEndpoint,
} from "../../../../scripts/desktop/dev/open-with.mjs";
import { getDesktopBuildChannelPolicy } from "../../../../shared/desktop-build-identity.mjs";

const identity = {
  applicationName: "PuppyOne",
  platformBuildNumber: "1",
  release: { baseVersion: "1.0.0", channel: "stable" },
};
const packagedTypes = applyMacosBuilderConfig({ config: {}, baseBuild: {}, identity }).mac.extendInfo.CFBundleDocumentTypes;
const runAsync = promisify(execFile);

const cleanups = [];
function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "p1-open-with-"));
  cleanups.push(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A stand-in for the dev instance's socket: records each request and answers with `reply`. */
async function fakeDevInstance(endpoint, reply) {
  const requests = [];
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (!buffer.includes("\n")) return;
      const request = JSON.parse(buffer.slice(0, buffer.indexOf("\n")));
      requests.push(request);
      socket.end(`${JSON.stringify(reply(request))}\n`);
    });
  });
  await new Promise((resolve) => server.listen(endpoint, resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  return requests;
}

/** Runs the Open With app's hand-off for `files` and returns what it would tell the user. */
async function handOff(root, endpoint, files) {
  const sourcePath = path.join(root, "opener.applescript");
  const scriptPath = path.join(root, "opener.scpt");
  fs.writeFileSync(sourcePath, createOpenerScript({ endpoint }));
  execFileSync("/usr/bin/osacompile", ["-o", scriptPath, sourcePath]);
  const items = files.map((file) => `POSIX file ${appleScriptString(file)}`).join(", ");
  // Asynchronous, so the fake dev instance in this process can answer.
  const { stdout } = await runAsync("/usr/bin/osascript", [
    "-e", `set opener to load script POSIX file ${appleScriptString(scriptPath)}`,
    "-e", `tell opener to handOff({${items}})`,
  ]);
  return stdout.replace(/\n$/, "");
}

const opened = (request) => ({
  ok: true,
  protocol: 1,
  results: request.paths.map((requestPath) => ({ path: requestPath, status: "opened" })),
});

describe("dev Open With app", () => {
  it("offers the packaged editor file types supported by the CLI, excluding template imports", () => {
    const droplet = {
      CFBundleExecutable: "droplet",
      CFBundleIdentifier: "T",
      CFBundleIconName: "droplet",
      CFBundleDocumentTypes: [{ CFBundleTypeExtensions: ["*"], CFBundleTypeOSTypes: ["****"], CFBundleTypeRole: "Viewer" }],
    };
    const info = createOpenerInfo(droplet);

    expect(info.CFBundleDocumentTypes).toEqual(packagedTypes.filter(type => type.CFBundleTypeRole === "Editor"));
    expect(info.CFBundleDocumentTypes.some(type => type.CFBundleTypeExtensions?.includes("puppyonetemplate"))).toBe(false);
    expect(info.CFBundleIdentifier).toBe(OPENER_BUNDLE_ID);
    expect(info.CFBundleExecutable).toBe("droplet");
    // An asset catalog icon would win over the dev icon.
    expect(info.CFBundleIconName).toBeUndefined();
  });

  it("quotes paths for AppleScript", () => {
    expect(appleScriptString(String.raw`/a "b"\c`)).toBe(String.raw`"/a \"b\"\\c"`);
  });

  it("reaches the dev channel's socket, which belongs to no checkout", () => {
    const userDataName = getDesktopBuildChannelPolicy("dev").userDataName;
    expect(devControlEndpoint({ homeDirectory: "/Users/example", uid: 501 }))
      .toBe(`/Users/example/Library/Application Support/${userDataName}/cli/control.sock`);
  });

  it.runIf(process.platform === "darwin")("asks the running dev instance to open each file, awkward paths intact", async () => {
    const root = temporaryDirectory();
    const endpoint = path.join(root, "dev.sock");
    const requests = await fakeDevInstance(endpoint, opened);
    const files = [`notes it's "here" \\ 中文.md`, "table.csv"].map((name) => path.join(root, name));
    for (const file of files) fs.writeFileSync(file, "x\n");

    expect(await handOff(root, endpoint, files)).toBe("");
    expect(requests).toEqual([{ protocol: 1, type: "open", paths: files }]);
  });

  it.runIf(process.platform === "darwin")("says so when npm run dev is not running", async () => {
    const root = temporaryDirectory();
    const file = path.join(root, "notes.md");
    fs.writeFileSync(file, "x\n");

    expect(await handOff(root, path.join(root, "nobody-listens.sock"), [file])).toBe(DEV_NOT_RUNNING_MESSAGE);
  });

  it.runIf(process.platform === "darwin")("passes on why the dev instance refused a file", async () => {
    const root = temporaryDirectory();
    const endpoint = path.join(root, "dev.sock");
    await fakeDevInstance(endpoint, (request) => ({
      ok: true,
      protocol: 1,
      results: [{ path: request.paths[0], status: "rejected", error: { code: "FILE_TOO_LARGE", message: "big.md is larger than 1 MB." } }],
    }));
    const file = path.join(root, "big.md");
    fs.writeFileSync(file, "x\n");

    expect(await handOff(root, endpoint, [file])).toBe("npm run dev did not open the file: big.md is larger than 1 MB.");
  });
});
