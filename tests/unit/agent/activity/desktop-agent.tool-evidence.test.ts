import { describe, expect, it } from "vitest";
import {
  agentToolEvidenceLimits,
  collectAgentToolResultLines,
  createAgentToolEvidencePreview,
  stringifyAgentToolInput,
} from "../../../../src/features/desktop-agent/domain/agent-tool-evidence";

describe("Desktop Agent tool evidence budgets", () => {
  it("preserves ordinary output exactly", () => {
    expect(createAgentToolEvidencePreview("first\nsecond")).toMatchObject({
      head: "first\nsecond",
      tail: "",
      sourceLength: 12,
      totalLines: 2,
      omittedChars: 0,
      omittedLines: 0,
      truncated: false,
    });
  });

  it("bounds adversarial many-line output while retaining head and tail evidence", () => {
    const source = Array.from({ length: 20_000 }, (_, index) => `line-${index}`).join("\n");
    const preview = createAgentToolEvidencePreview(source);

    expect(preview.truncated).toBe(true);
    expect(preview.totalLines).toBe(20_000);
    expect(preview.head).toContain("line-0");
    expect(preview.tail).toContain("line-19999");
    expect(preview.head.length + preview.tail.length).toBeLessThanOrEqual(agentToolEvidenceLimits.maxChars);
    expect(preview.omittedLines).toBeGreaterThan(19_000);
  });

  it("bounds one pathological line without asking layout to wrap it", () => {
    const preview = createAgentToolEvidencePreview("x".repeat(2_000_000));

    expect(preview.truncated).toBe(true);
    expect(preview.totalLines).toBe(1);
    expect(preview.head.length).toBeLessThanOrEqual(agentToolEvidenceLimits.maxLineChars);
    expect(preview.tail).toBe("");
    expect(preview.omittedChars).toBeGreaterThan(1_900_000);
  });

  it("collects only mountable search rows while reporting the full result count", () => {
    const source = Array.from({ length: 50_000 }, (_, index) => `src/file-${index}.ts:${index + 1}:match`).join("\n");
    const results = collectAgentToolResultLines(source);

    expect(results.lines).toHaveLength(80);
    expect(results.totalLines).toBe(50_000);
    expect(results.omittedLines).toBe(49_920);
    expect(results.lines.at(-1)).toContain("file-79.ts");
  });

  it("serializes cyclic and wide structured input within an aggregate budget", () => {
    const input: Record<string, unknown> = Object.fromEntries(Array.from({ length: 1_000 }, (_, index) => [
      `key-${index}`,
      "x".repeat(8_000),
    ]));
    input.self = input;
    const serialized = stringifyAgentToolInput(input);

    expect(serialized).not.toBeNull();
    expect(serialized!.length).toBeLessThanOrEqual(32 * 1024);
    expect(serialized).toContain("truncated");
  });
});
