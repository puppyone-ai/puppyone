import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPiTurnInput } from "../../../../../electron/main/agent/runtimes/pi/pi-prompt-input.mjs";

const roots = [];
afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Pi native reference mapping", () => {
  it("keeps non-image files as authorized native path mentions and sends images on Pi's media channel", async () => {
    const workspaceRoot = await temporaryDirectory("pi-workspace-");
    const stagedRoot = await temporaryDirectory("pi-staged-");
    await mkdir(path.join(workspaceRoot, "notes"));
    await writeFile(path.join(workspaceRoot, "notes", "brief.md"), "brief");
    const imagePath = path.join(stagedRoot, "screen.png");
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const input = await buildPiTurnInput({
      workspaceRoot,
      prompt: "Review both",
      references: [
        { kind: "workspace-entry", path: "notes/brief.md", displayName: "brief.md" },
        { kind: "staged-attachment", path: imagePath, mime: "image/png", displayName: "screen.png" },
      ],
    });
    expect(input.message).toContain("Review both");
    expect(input.message).toContain(path.join(workspaceRoot, "notes", "brief.md"));
    expect(input.images).toEqual([{ type: "image", data: "iVBORw==", mimeType: "image/png" }]);
  });

  it("accepts an authorized external file only when it is an inline native path mention", async () => {
    const workspaceRoot = await temporaryDirectory("pi-workspace-");
    const externalRoot = await temporaryDirectory("pi-external-");
    const filename = path.join(externalRoot, "outside.txt");
    await writeFile(filename, "outside");
    const input = await buildPiTurnInput({
      workspaceRoot,
      prompt: `Read ${filename}`,
      references: [{
        kind: "staged-attachment",
        path: filename,
        mime: "text/plain",
        inlineMentioned: true,
        mentionDelivery: "path",
      }],
    });
    expect(input.message).toContain(filename);

    await expect(buildPiTurnInput({
      workspaceRoot,
      prompt: "Read it",
      references: [{ kind: "staged-attachment", path: filename, mime: "text/plain" }],
    })).rejects.toMatchObject({ code: "REFERENCE_KIND_UNSUPPORTED" });
  });

  it("rejects a forged workspace-relative traversal before it reaches Pi", async () => {
    const workspaceRoot = await temporaryDirectory("pi-workspace-");
    await expect(buildPiTurnInput({
      workspaceRoot,
      prompt: "Read it",
      references: [{ kind: "workspace-entry", path: "../secret.txt", mime: "text/plain" }],
    })).rejects.toMatchObject({ code: "REFERENCE_UNAUTHORIZED" });
  });
});

async function temporaryDirectory(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}
