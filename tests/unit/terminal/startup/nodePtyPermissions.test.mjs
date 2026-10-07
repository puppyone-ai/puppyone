import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { repairNodePtyPermissions } from "../../../../scripts/node-pty-permissions.mjs";

const roots = [];

function fixture(directory, mode = 0o644) {
  const root = mkdtempSync(path.join(os.tmpdir(), "puppyone-pty-permissions-"));
  roots.push(root);
  const helper = path.join(root, "node_modules/node-pty", directory, "spawn-helper");
  mkdirSync(path.dirname(helper), { recursive: true });
  writeFileSync(helper, "fixture");
  chmodSync(helper, mode);
  return { root, helper };
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe.skipIf(process.platform === "win32")("PTY dependency execution permissions", () => {
  it.each(["build/Release", "build/Debug", "prebuilds/darwin-arm64", "prebuilds/darwin-x64"])("repairs %s even when install scripts were skipped", directory => {
    const { root, helper } = fixture(directory);
    expect(repairNodePtyPermissions(root)).toEqual([helper]);
    expect(statSync(helper).mode & 0o777).toBe(0o755);
    expect(repairNodePtyPermissions(root)).toEqual([]);
  });
  it("preserves existing read/write permissions", () => {
    const { root, helper } = fixture("prebuilds/darwin-arm64", 0o640);
    repairNodePtyPermissions(root);
    expect(statSync(helper).mode & 0o666).toBe(0o640);
  });
  it("allows missing dependencies in metadata-only preparation fixtures", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "puppyone-pty-missing-"));
    roots.push(root);
    expect(repairNodePtyPermissions(root)).toEqual([]);
  });
});
