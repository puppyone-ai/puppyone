import { describe, expect, it } from "vitest";
import {
  agentPromptMentionText,
  normalizeAgentPromptMentions,
  splitAgentPromptMentions,
} from "../../../../src/features/desktop-agent/domain/agent-prompt-mentions";

describe("Desktop Agent structured prompt mentions", () => {
  it("keeps UTF-16 ranges stable for Unicode text and presents a file as one semantic segment", () => {
    const prompt = "看一下 @SECURITY.md 然后总结";
    const start = prompt.indexOf("@SECURITY.md");
    const mentions = normalizeAgentPromptMentions(prompt, [{
      referenceId: "ref-security",
      start,
      end: start + "@SECURITY.md".length,
    }]);

    expect(splitAgentPromptMentions(prompt, mentions)).toEqual([
      { kind: "text", text: "看一下 " },
      { kind: "mention", text: "@SECURITY.md", mention: mentions[0] },
      { kind: "text", text: " 然后总结" },
    ]);
  });

  it("drops stale, overlapping and out-of-range decorations instead of corrupting the draft", () => {
    expect(normalizeAgentPromptMentions("@a.md @b.md", [
      { referenceId: "ref-a", start: 0, end: 5 },
      { referenceId: "ref-b", start: 3, end: 11 },
      { referenceId: "ref-oob", start: 12, end: 99 },
    ], new Set(["ref-a", "ref-b", "ref-oob"]))).toEqual([
      { referenceId: "ref-a", start: 0, end: 5 },
    ]);
  });

  it("sanitizes control characters while preserving human-readable file names", () => {
    expect(agentPromptMentionText({
      id: "external-notes",
      kind: "staged-attachment",
      displayName: "release\nnotes.md",
      mime: "text/markdown",
      size: 1,
      status: "ready",
    })).toBe("@release notes.md");
  });

  it("uses the portable workspace-relative identity so same-name files stay distinguishable", () => {
    expect(agentPromptMentionText({
      id: "workspace-guides-notes",
      kind: "workspace-entry",
      entryType: "file",
      relativePath: "docs/guides/notes.md",
      displayName: "notes.md",
      mime: "text/markdown",
      size: 1,
      status: "ready",
    })).toBe("@docs/guides/notes.md");
  });
});
