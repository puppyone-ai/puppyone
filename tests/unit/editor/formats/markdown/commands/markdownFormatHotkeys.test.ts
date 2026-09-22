/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { matchMarkdownFormatHotkey } from "../../../../../../packages/shared-ui/src/editor/markdown/core/commands/markdownFormatHotkeys";

describe("Markdown format hotkeys", () => {
  it("matches the product inline-format shortcut contract", () => {
    expect(matchMarkdownFormatHotkey(createHotkey({ key: "b", metaKey: true }))).toBe("strong");
    expect(matchMarkdownFormatHotkey(createHotkey({ key: "i", metaKey: true }))).toBe("emphasis");
    expect(matchMarkdownFormatHotkey(createHotkey({ key: "u", metaKey: true }))).toBe("underline");
    expect(matchMarkdownFormatHotkey(createHotkey({ key: "d", metaKey: true }))).toBe("strike");
    expect(matchMarkdownFormatHotkey(createHotkey({ key: "x", metaKey: true, shiftKey: true }))).toBe("strike");
  });

  it("ignores shifted letter shortcuts other than strikethrough", () => {
    expect(matchMarkdownFormatHotkey(createHotkey({ key: "b", metaKey: true, shiftKey: true }))).toBeNull();
    expect(matchMarkdownFormatHotkey(createHotkey({ key: "i", ctrlKey: true }))).toBe("emphasis");
  });
});

function createHotkey(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", { ...init, cancelable: true });
}
