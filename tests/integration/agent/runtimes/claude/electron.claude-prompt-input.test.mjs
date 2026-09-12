import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildClaudeUserMessageContent,
  CLAUDE_NATIVE_IMAGE_MAX_BYTES,
} from "../../../../../electron/main/agent/runtimes/claude/claude-prompt-input.mjs";
import { createClaudeUserMessage } from "../../../../../electron/main/agent/runtimes/claude/claude-message-channel.mjs";

const temporaryRoots = [];

afterEach(async () => Promise.all(temporaryRoots.splice(0).map((root) => (
  fs.promises.rm(root, { recursive: true, force: true })
))));

describe("Claude Agent SDK native reference mapping", () => {
  it("combines workspace path context with a native structured image block", async () => {
    const root = await temporaryRoot();
    const source = path.join(root, "outside.png");
    await fs.promises.writeFile(source, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const content = await buildClaudeUserMessageContent({
      prompt: "Review both",
      workspaceRoot: path.join(root, "workspace"),
      references: [
        { kind: "workspace-entry", path: path.join(root, "workspace", "src", "app.ts"), mime: "text/typescript" },
        { kind: "staged-attachment", path: source, name: "outside.png", mime: "image/png" },
      ],
    });

    expect(content).toEqual([
      {
        type: "text",
        text: expect.stringContaining(path.join(root, "workspace", "src", "app.ts")),
      },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64"),
        },
      },
    ]);
    expect(createClaudeUserMessage(content, "claude-session")).toMatchObject({
      type: "user",
      session_id: "claude-session",
      message: { role: "user", content },
    });
  });

  it("accepts an authorized external file path mention and rejects cross-workspace paths", async () => {
    const root = await temporaryRoot();
    const markdown = path.join(root, "notes.md");
    await fs.promises.writeFile(markdown, "notes");
    await expect(buildClaudeUserMessageContent({
      prompt: `Review \`${markdown}\``,
      workspaceRoot: path.join(root, "workspace-a"),
      references: [{ authorized: true, kind: "staged-attachment", path: markdown, name: "notes.md", mime: "text/markdown", inlineMentioned: true, mentionDelivery: "path" }],
    })).resolves.toBe(`Review \`${markdown}\``);
    await expect(buildClaudeUserMessageContent({
      prompt: "Review",
      workspaceRoot: path.join(root, "workspace-a"),
      references: [{ kind: "workspace-entry", path: path.join(root, "workspace-b", "secret.png"), mime: "image/png" }],
    })).rejects.toMatchObject({ code: "REFERENCE_UNAUTHORIZED" });
  });

  it("enforces Claude's native per-image bound before base64 expansion", async () => {
    const root = await temporaryRoot();
    const oversized = path.join(root, "oversized.png");
    await fs.promises.writeFile(oversized, "");
    await fs.promises.truncate(oversized, CLAUDE_NATIVE_IMAGE_MAX_BYTES + 1);
    await expect(buildClaudeUserMessageContent({
      prompt: "Review",
      workspaceRoot: path.join(root, "workspace"),
      references: [{ kind: "staged-attachment", path: oversized, name: "oversized.png", mime: "image/png" }],
    })).rejects.toMatchObject({ code: "REFERENCE_MATERIALIZATION_FAILED" });
  });
});

async function temporaryRoot() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-claude-input-"));
  temporaryRoots.push(root);
  await fs.promises.mkdir(path.join(root, "workspace", "src"), { recursive: true });
  await fs.promises.mkdir(path.join(root, "workspace-a"), { recursive: true });
  await fs.promises.mkdir(path.join(root, "workspace-b"), { recursive: true });
  return root;
}
