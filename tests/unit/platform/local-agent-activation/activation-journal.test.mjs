import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createActivationJournal } from "../../../../electron/main/local-agent-activation/activation-journal.mjs";
import { assertActivationSnapshot } from "../../../../shared/local-agent-activation/schema.mjs";

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture(value) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-activation-journal-")); roots.push(root);
  const file = path.join(root, "journal.json"); await fs.writeFile(file, JSON.stringify(value));
  return { file, journal: createActivationJournal(file) };
}
function legacy(status = "authentication-required", installed = true) {
  return { epoch: "old", revision: 2, operations: [{ operationId: "old-task", setupId: "codex", displayName: "Codex", status,
    installed, errorCode: null, updatedAt: 1, steps: [
      { id: "prepare", status: "complete" }, { id: "install", status: "complete" },
      { id: "login", status: "running" }, { id: "verify", status: "pending" },
    ] }] };
}
describe("installation-only activation journal migration", () => {
  it.each(["authentication-required", "authenticating", "verifying", "detected"])("migrates installed %s receipts without requiring login", async status => {
    const value = legacy(status); const { file, journal } = await fixture(value);
    const operations = await journal.read();
    expect(operations[0]).toMatchObject({ status: "ready", installed: true, errorCode: null,
      steps: ["prepare", "install", "verify"].map(id => ({ id, status: "complete" })) });
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual(value); // Reading never writes or resumes work.
    await journal.write({ epoch: "new", revision: 1, operations });
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toMatchObject({ schemaVersion: 2 });
    expect(await journal.read()).toEqual(operations);
  });
  it.each(["authentication", "verification"])("retires obsolete %s failures after installation", async errorCode => {
    const value = legacy("failed"); value.operations[0].errorCode = errorCode;
    expect((await (await fixture(value)).journal.read())[0]).toMatchObject({ status: "ready", errorCode: null });
  });
  it("does not fabricate an installation when an old receipt lacks it", async () => {
    const { journal } = await fixture(legacy("authentication-required", false));
    expect((await journal.read())[0]).toMatchObject({ status: "interrupted", installed: false, errorCode: "interrupted" });
  });
  it("leaves cancelled operation history intact", async () => {
    const { journal } = await fixture(legacy("cancelled"));
    expect((await journal.read())[0]).toMatchObject({ status: "cancelled", installed: true });
  });
  it.each(["state", "step", "extra", "version"])("fails closed on malformed legacy or unknown journal %s", async kind => {
    let value = legacy();
    if (kind === "state") value.operations[0].status = "unknown";
    if (kind === "step") value.operations[0].steps[2].status = "unknown";
    if (kind === "extra") value.operations[0].command = "unexpected";
    if (kind === "version") value = { schemaVersion: 3, snapshot: value };
    const { journal } = await fixture(value); await expect(journal.read()).rejects.toThrow();
  });
  it("never accepts the old contract at the live IPC boundary", () => {
    expect(() => assertActivationSnapshot(legacy())).toThrow();
  });
});
