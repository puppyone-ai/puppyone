import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const temporary = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

async function executeUploadStage(failingTarget, stageName = "Upload both immutable R2 releases", draft = "true") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "release upload test "));
  temporary.push(directory);
  const workflow = await fs.readFile(path.join(root, ".github/workflows/desktop-stable-release-publish.yml"), "utf8");
  for (const target of ["mac", "windows"]) {
    const bundle = path.join(directory, target);
    await fs.mkdir(path.join(bundle, "assets"), { recursive: true });
    await fs.writeFile(path.join(bundle, "assets", `${target}.bin`), "fixture");
    await fs.writeFile(path.join(bundle, "release.json"), JSON.stringify({ assets: [{ name: `${target}.bin`, kind: "artifact" }] }));
    await fs.writeFile(path.join(bundle, "SHA256SUMS"), "fixture");
    await fs.writeFile(path.join(bundle, "build-info.json"), "{}");
  }
  const stage = workflow.split(`      - name: ${stageName}`)[1].split("      - name:")[0];
  const body = stage.split("        run: |\n")[1].split("\n").map(line => line.replace(/^ {10}/, "")).join("\n");
  const prelude = `set -euo pipefail
rendezvous() {
  local target="$1"
  if [ ! -f "$EVIDENCE/$target.started" ]; then
    touch "$EVIDENCE/$target.started"
    local ready=false
    for attempt in $(seq 1 100); do
      if [ -f "$EVIDENCE/mac.started" ] && [ -f "$EVIDENCE/windows.started" ]; then ready=true; break; fi
      sleep 0.02
    done
    if [ "$ready" != true ]; then echo serial-upload-deadlock >&2; return 9; fi
    if [ "$FAIL_TARGET" = "$target" ]; then return 7; fi
    sleep 0.1
  fi
}
aws() {
  if [ "$1" = s3api ]; then return 1; fi
  local target
  case "$*" in *s3://fixture/mac*) target=mac;; *) target=windows;; esac
  rendezvous "$target"
  echo "$target $*" >> "$EVIDENCE/events"
}
gh() {
  if [ "$1" = api ]; then
    if [ "$2" = --paginate ]; then echo 42; else printf '{"assets":[]}'; fi
    return
  fi
  local target
  case "$4" in */mac/*) target=mac;; *) target=windows;; esac
  rendezvous "$target"
  echo "$target $*" >> "$EVIDENCE/events"
}
`;
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
  const child = spawn(bash, ["--noprofile", "--norc", "-s"], {
    cwd: root,
    env: { ...process.env, EVIDENCE: directory.replaceAll("\\", "/"), FAIL_TARGET: failingTarget,
      CLOUDFLARE_ACCOUNT_ID: "fixture", R2_BUCKET: "fixture", MACOS_R2_PREFIX: "mac", WINDOWS_R2_PREFIX: "windows",
      MACOS_LATEST_PREFIX: "mac", WINDOWS_LATEST_PREFIX: "windows", EXISTING_DRAFT: draft,
      RUNNER_TEMP: directory.replaceAll("\\", "/"), RELEASE_TAG: "v1.2.3", GITHUB_REPOSITORY: "fixture/release",
      MACOS_BUNDLE_DIRECTORY: path.join(directory, "mac").replaceAll("\\", "/"),
      WINDOWS_BUNDLE_DIRECTORY: path.join(directory, "windows").replaceAll("\\", "/") },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", data => { output += data; });
  child.stderr.on("data", data => { output += data; });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
    child.stdin.end(`${prelude}\n${body}\necho subsequent-publication\n`);
  });
  const events = await fs.readFile(path.join(directory, "events"), "utf8").catch(() => "");
  return { code, output, events };
}

describe("actual Stable workflow parallel upload stage", () => {
  it.each(["Upload both target asset sets to the draft", "Stage non-pointer latest payloads for both platforms"])("runs both targets concurrently in %s", async stage => {
    const result = await executeUploadStage("", stage);
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain("subsequent-publication");
    expect(result.events).toContain("mac.bin");
    expect(result.events).toContain("windows.bin");
    if (stage.includes("draft")) {
      expect(result.events.match(/\/release.json/g)).toHaveLength(1);
      expect(result.events).toContain("/mac/release.json");
    }
  });
  it.each(["Upload both target asset sets to the draft", "Stage non-pointer latest payloads for both platforms"])("drains the sibling and blocks publication on failure in %s", async stage => {
    const result = await executeUploadStage("windows", stage);
    expect(result.code, result.output).not.toBe(0);
    expect(result.output).not.toContain("subsequent-publication");
    expect(result.events).toContain("mac.bin");
    expect(result.events).not.toContain("windows.bin");
  });
  it("refuses to add missing assets to an already-public release", async () => {
    const result = await executeUploadStage("", "Upload both target asset sets to the draft", "false");
    expect(result.code).not.toBe(0);
    expect(result.events).toBe("");
    expect(result.output).toContain("refusing mutation");
  });
  it("starts both target uploads before either completes, then writes each commit marker last", async () => {
    const result = await executeUploadStage("");
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain("subsequent-publication");
    for (const target of ["mac", "windows"]) {
      const events = result.events.split("\n").filter(line => line.startsWith(`${target} `));
      expect(events[0]).toContain("s3 sync");
      expect(events.at(-1)).toContain(`s3://fixture/${target}/release.json`);
    }
  });
  it.each(["mac", "windows"])("blocks publication when %s fails and drains the other writer first", async target => {
    const result = await executeUploadStage(target);
    expect(result.code, result.output).not.toBe(0);
    expect(result.output).not.toContain("subsequent-publication");
    expect(result.output).toContain("all target writers have stopped");
    expect(result.events).not.toContain(`s3://fixture/${target}/release.json`);
    const sibling = target === "mac" ? "windows" : "mac";
    expect(result.events).toContain(`s3://fixture/${sibling}/release.json`);
  });
});
