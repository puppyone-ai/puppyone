import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAcpPromptBlocks,
  materializeAcpReferences,
} from "../../../../../electron/main/agent/protocols/acp/acp-prompt-input.mjs";

const temporaryRoots = [];

afterEach(async () => Promise.all(temporaryRoots.splice(0).map((root) => (
  fs.promises.rm(root, { recursive: true, force: true })
))));

describe("ACP native reference mapping", () => {
  it("embeds bounded UTF-8 text only after embeddedContext negotiation", async () => {
    const root = await temporaryRoot();
    const filename = path.join(root, "notes.md");
    await fs.promises.writeFile(filename, "# Notes\n\nKeep this exact.");
    const [materialized] = await materializeAcpReferences([{
      id: "ref-text",
      kind: "staged-attachment",
      path: filename,
      name: "notes.md",
      mime: "text/markdown",
    }], { embeddedText: true });

    const blocks = buildAcpPromptBlocks({
      prompt: "Review this",
      workspaceRoot: root,
      references: [materialized],
      profile: { embeddedText: true },
    });

    expect(blocks).toEqual([
      { type: "text", text: "Review this" },
      {
        type: "resource",
        resource: {
          uri: "puppyone-attachment://local/ref-text/notes.md",
          mimeType: "text/markdown",
          text: "# Notes\n\nKeep this exact.",
        },
      },
    ]);
    expect(JSON.stringify(blocks)).not.toContain(filename);
  });

  it("rejects text when the ACP runtime did not negotiate embeddedContext", async () => {
    const root = await temporaryRoot();
    const filename = path.join(root, "notes.md");
    await fs.promises.writeFile(filename, "notes");
    await expect(materializeAcpReferences([{
      kind: "staged-attachment",
      path: filename,
      name: "notes.md",
      mime: "text/markdown",
    }], { embeddedText: false })).rejects.toMatchObject({
      code: "REFERENCE_RUNTIME_CAPABILITY_MISSING",
    });
  });

  it("rejects invalid UTF-8 and generic binary files without silent omission", async () => {
    const root = await temporaryRoot();
    const invalidText = path.join(root, "invalid.txt");
    const pdf = path.join(root, "paper.pdf");
    await fs.promises.writeFile(invalidText, Buffer.from([0xff, 0xfe, 0xfd]));
    await fs.promises.writeFile(pdf, "%PDF-1.7");
    await expect(materializeAcpReferences([{
      kind: "staged-attachment",
      path: invalidText,
      name: "invalid.txt",
      mime: "text/plain",
    }], { embeddedText: true })).rejects.toMatchObject({ code: "REFERENCE_MATERIALIZATION_FAILED" });
    await expect(materializeAcpReferences([{
      kind: "staged-attachment",
      path: pdf,
      name: "paper.pdf",
      mime: "application/pdf",
    }], { embeddedText: true })).rejects.toMatchObject({ code: "REFERENCE_RUNTIME_CAPABILITY_MISSING" });
  });

  it("keeps workspace resource links inside the assigned workspace", () => {
    expect(() => buildAcpPromptBlocks({
      prompt: "Inspect",
      workspaceRoot: "/workspace-a",
      references: [{ kind: "workspace-entry", path: "/workspace-b/secret.txt" }],
    })).toThrow(/invalid workspace reference/i);
  });

  it("keeps an inline display mention while delivering workspace data as an ACP resource link", async () => {
    const root = await temporaryRoot();
    const filename = path.join(root, "notes.md");
    await fs.promises.writeFile(filename, "notes");

    expect(buildAcpPromptBlocks({
      prompt: "Review @notes.md",
      workspaceRoot: root,
      references: [{ kind: "workspace-entry", path: filename, name: "notes.md", inlineMentioned: true }],
    })).toEqual([
      { type: "text", text: "Review @notes.md" },
      { type: "resource_link", uri: pathToFileURL(filename).href, name: "notes.md", title: "notes.md" },
    ]);
  });
});

async function temporaryRoot() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-acp-input-"));
  temporaryRoots.push(root);
  return root;
}
