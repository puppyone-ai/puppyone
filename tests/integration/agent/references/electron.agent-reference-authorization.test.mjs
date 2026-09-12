import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  authorizeAgentReferences,
  agentReferenceLimits,
  createAgentReferenceBudget,
  workspaceDraftReferences,
} from "../../../../electron/main/agent/agent-reference-authorization.mjs";

const temporaryRoots = [];
afterEach(async () => Promise.all(temporaryRoots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true }))));

describe("Agent attachment and context authorization", () => {
  it("canonicalizes workspace files, deduplicates them, and derives renderer-independent metadata", async () => {
    const root = await temporaryRoot();
    const filename = path.join(root, "notes.md");
    await fs.promises.writeFile(filename, "hello");
    const result = await authorizeAgentReferences({ workspaceRoot: root, references: [{ path: filename }, filename] });
    expect(result).toEqual([expect.objectContaining({
      authorized: true,
      kind: "workspace-entry",
      entryType: "file",
      path: await fs.promises.realpath(filename),
      relativePath: "notes.md",
      displayName: "notes.md",
      name: "notes.md",
      mime: "text/markdown",
      size: 5,
      status: "ready",
    })]);
    expect(result[0]).not.toHaveProperty("snapshotUrl");
    expect(agentReferenceLimits.maxReferences).toBe(32);
    expect(agentReferenceLimits.maxTotalReferenceBytes).toBe(25 * 1024 * 1024);
  });

  it("resolves relative workspace paths but fails closed for symlinks escaping the workspace", async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const secret = path.join(outside, "secret.txt");
    const link = path.join(root, "escape.txt");
    await fs.promises.writeFile(secret, "secret");
    await fs.promises.symlink(secret, link);
    await fs.promises.writeFile(path.join(root, "relative.txt"), "inside");
    await expect(authorizeAgentReferences({ workspaceRoot: root, references: [{ path: "relative.txt" }] }))
      .resolves.toEqual([expect.objectContaining({ relativePath: "relative.txt", entryType: "file" })]);
    await expect(authorizeAgentReferences({ workspaceRoot: root, references: [{ path: link }] })).rejects.toThrow(/inside the assigned workspace/i);
  });

  it("authorizes directory identity without recursively reading its contents", async () => {
    const root = await temporaryRoot();
    await fs.promises.mkdir(path.join(root, "src"));
    await fs.promises.writeFile(path.join(root, "src", "secret.txt"), "not snapshotted");
    const result = await authorizeAgentReferences({ workspaceRoot: root, references: ["src"] });
    expect(result).toEqual([expect.objectContaining({
      kind: "workspace-entry",
      entryType: "directory",
      relativePath: "src",
      size: 0,
    })]);
  });

  it("keeps workspace identity portable across session roots and withholds absolute paths from Renderer drafts", async () => {
    const firstRoot = await temporaryRoot();
    const secondRoot = await temporaryRoot();
    await Promise.all([
      fs.promises.mkdir(path.join(firstRoot, "docs")),
      fs.promises.mkdir(path.join(secondRoot, "docs")),
    ]);
    await Promise.all([
      fs.promises.writeFile(path.join(firstRoot, "docs", "notes.md"), "first"),
      fs.promises.writeFile(path.join(secondRoot, "docs", "notes.md"), "second"),
    ]);

    const [first] = await authorizeAgentReferences({
      workspaceRoot: firstRoot,
      references: [{ relativePath: "docs/notes.md", entryType: "file" }],
    });
    const [second] = await authorizeAgentReferences({
      workspaceRoot: secondRoot,
      references: [{ relativePath: "docs/notes.md", entryType: "file" }],
    });

    expect(first.id).toBe(second.id);
    expect(first.path).not.toBe(second.path);
    expect(workspaceDraftReferences([first])).toEqual([expect.objectContaining({
      id: first.id,
      relativePath: "docs/notes.md",
      displayName: "notes.md",
    })]);
    expect(workspaceDraftReferences([first])[0]).not.toHaveProperty("path");
  });

  it("rejects forged absolute and traversal identities before filesystem authorization", async () => {
    const root = await temporaryRoot();
    await expect(authorizeAgentReferences({
      workspaceRoot: root,
      references: [{ relativePath: "../outside.md", entryType: "file" }],
    })).rejects.toThrow(/workspace-relative identity/i);
    await expect(authorizeAgentReferences({
      workspaceRoot: root,
      references: [{ relativePath: "/private/outside.md", entryType: "file" }],
    })).rejects.toThrow(/workspace-relative identity/i);
    await expect(authorizeAgentReferences({
      workspaceRoot: root,
      references: [{ relativePath: "C:private\\outside.md", entryType: "file" }],
    })).rejects.toThrow(/workspace-relative identity/i);
  });

  it("shares one byte and file-count budget across attachments and context", async () => {
    const root = await temporaryRoot();
    const attachment = path.join(root, "image.png");
    const context = path.join(root, "context.md");
    await fs.promises.writeFile(attachment, "image");
    await fs.promises.writeFile(context, "context");
    const budget = createAgentReferenceBudget();

    await authorizeAgentReferences({ workspaceRoot: root, references: [attachment], budget });
    await authorizeAgentReferences({ workspaceRoot: root, references: [context], budget });

    expect(budget).toEqual({
      remainingBytes: agentReferenceLimits.maxTotalReferenceBytes - 12,
      remainingReferences: agentReferenceLimits.maxReferences - 2,
    });
  });
});

async function temporaryRoot() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-agent-reference-"));
  temporaryRoots.push(root);
  return root;
}
