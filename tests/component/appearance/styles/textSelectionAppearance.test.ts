/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { retainTextSelectionAppearance } from "../../../../packages/shared-ui/src/core/appearance/textSelectionAppearance";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose());
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function select(element: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

describe("selection focus presentation", () => {
  it("tracks readonly selection focus and window state without modifying the range", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const dispose = retainTextSelectionAppearance(document); cleanups.push(dispose);
    const paragraph = document.createElement("p"); paragraph.textContent = "selected text";
    const button = document.createElement("button");
    document.body.append(paragraph, button);
    select(paragraph);
    expect(paragraph.dataset.poNativeSelection).toBe("active");
    button.focus();
    expect(paragraph.dataset.poNativeSelection).toBe("inactive");
    expect(document.getSelection()?.toString()).toBe("selected text");
    window.dispatchEvent(new Event("blur"));
    expect(document.documentElement.dataset.poWindowActive).toBe("false");
    button.blur(); window.dispatchEvent(new Event("focus"));
    expect(paragraph.dataset.poNativeSelection).toBe("active");
    dispose();
    expect(paragraph.hasAttribute("data-po-native-selection")).toBe(false);
    expect(document.getSelection()?.toString()).toBe("selected text");
  });

  it("shares one document lease and makes cleanup idempotent", () => {
    const first = retainTextSelectionAppearance(document);
    const second = retainTextSelectionAppearance(document); cleanups.push(first, second);
    first(); first();
    window.dispatchEvent(new Event("blur"));
    expect(document.documentElement.dataset.poWindowActive).toBe("false");
    second();
    expect(document.documentElement.hasAttribute("data-po-window-active")).toBe(false);
  });

  it("never writes focus decorations inside CodeMirror-managed content", () => {
    const host = document.createElement("div"); host.dataset.poSelectionRenderer = "native";
    const line = document.createElement("div"); line.textContent = "selection source";
    host.append(line); document.body.append(host);
    cleanups.push(retainTextSelectionAppearance(document));
    select(line);
    expect(host.querySelector("[data-po-native-selection]")).toBeNull();
    expect(document.getSelection()?.toString()).toBe("selection source");
  });
});
