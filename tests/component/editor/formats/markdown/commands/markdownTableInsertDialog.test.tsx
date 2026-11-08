/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownTableInsertDialog } from "../../../../../../src/shared-ui/editor/markdown/MarkdownTableInsertDialog";
import { withTestLocalization } from "../../../../../support/react/localization";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); });
describe("Markdown table insertion dialog", () => {
  it("chooses a table shape and submits it without losing the editor selection", () => {
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const onInsert = vi.fn(); const onCancel = vi.fn();
    act(() => root?.render(withTestLocalization(<MarkdownTableInsertDialog onInsert={onInsert} onCancel={onCancel} />)));
    expect(document.body.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("true");
    const inputs = document.body.querySelectorAll<HTMLInputElement>('input[type="number"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(inputs[0], "4");
      inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => document.body.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onInsert).toHaveBeenCalledWith({ rows: 4, columns: 2 });
    expect(onCancel).not.toHaveBeenCalled();
  });
  it("cancels with Escape and traps Tab within the dialog", () => {
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const onCancel = vi.fn();
    act(() => root?.render(withTestLocalization(<MarkdownTableInsertDialog onInsert={vi.fn()} onCancel={onCancel} />)));
    const submit = document.body.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    act(() => { submit.focus(); submit.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(document.body.querySelector("input"));
    act(() => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
