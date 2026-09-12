/** @vitest-environment happy-dom */

import React from "react";
import { EditorView } from "@codemirror/view";

import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { AgentComposer } from "../../../../src/features/desktop-agent/ui/AgentComposer";

import { stripBidiIsolation, testT, withTestLocalization } from "../../../support/react/localization";
import { root, render } from "../../../support/agent/rendererHarness";

describe("Desktop Agent renderer surfaces", () => {

  it("leaves pointer selection to CodeMirror without stealing button focus", () => {
    const onDraftChange = vi.fn();
    const container = render(React.createElement(AgentComposer, {
      draft: "Ready",
      onDraftChange,
      disabled: false,
      running: false,
      stopping: false,
      submitting: false,
      placeholder: "Ask anything",
      onSubmit: vi.fn(async () => true),
      onStop: vi.fn(),
    }));
    const composerSurface = container.querySelector(".desktop-agent-composer") as HTMLElement;
    const promptEditor = container.querySelector(".cm-content") as HTMLElement;
    const sendControl = container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement;

    act(() => promptEditor.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 1,
      clientY: 1,
    })));
    expect(document.activeElement).toBe(promptEditor);

    act(() => promptEditor.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "End",
      code: "End",
    })));
    act(() => promptEditor.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Backspace",
      code: "Backspace",
    })));
    expect(onDraftChange).toHaveBeenLastCalledWith("Read");

    act(() => sendControl.focus());
    act(() => composerSurface.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 })));
    expect(document.activeElement).toBe(sendControl);

    act(() => sendControl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 })));
    expect(document.activeElement).toBe(sendControl);
  });

  it.each([false, true])("leaves early IME Enter to native composition (shift=%s)", (shiftKey) => {
    const onSubmit = vi.fn(async () => true);
    const onDraftChange = vi.fn();
    const container = render(React.createElement(AgentComposer, {
      draft: "正在输入", onDraftChange, disabled: false, running: false,
      stopping: false, submitting: false, onSubmit, onStop: vi.fn(),
    }));
    const content = container.querySelector<HTMLElement>(".cm-content")!;
    const view = EditorView.findFromDOM(content)!;
    const confirm = new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", keyCode: 13, isComposing: true, shiftKey, bubbles: true, cancelable: true,
    });
    act(() => {
      content.focus();
      content.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "你" }));
      expect(view.compositionStarted).toBe(true);
      expect(view.composing).toBe(false); // IME is active before the first text change.
      content.dispatchEvent(confirm);
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onDraftChange).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe("正在输入");
    expect(confirm.defaultPrevented).toBe(false);
    act(() => content.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
    expect(view.compositionStarted).toBe(false);
    act(() => content.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true,
    })));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("正在输入");
  });

  it("uses Shift+Enter for a newline and plain Enter for one submission", () => {
    const onSubmit = vi.fn(async () => true);
    function ControlledComposer() {
      const [draft, setDraft] = React.useState("Draft");
      return React.createElement(AgentComposer, {
        draft, onDraftChange: setDraft, disabled: false, running: false,
        stopping: false, submitting: false, onSubmit, onStop: vi.fn(),
      });
    }
    const container = render(React.createElement(ControlledComposer));
    const content = container.querySelector<HTMLElement>(".cm-content")!;
    const view = EditorView.findFromDOM(content)!;
    act(() => {
      content.focus();
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      content.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", code: "Enter", keyCode: 13, shiftKey: true, bubbles: true, cancelable: true,
      }));
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe("Draft\n");
    act(() => content.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true,
    })));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("Draft\n");
  });

  it("leaves composer auto-sizing to CSS while controlled draft text changes", () => {
    const OriginalResizeObserver = globalThis.ResizeObserver;
    let constructions = 0;
    class StableResizeObserver {
      constructor(_callback: ResizeObserverCallback) { constructions += 1; }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = StableResizeObserver as unknown as typeof ResizeObserver;
    const props = {
      onDraftChange: vi.fn(),
      disabled: false,
      running: false,
      stopping: false,
      submitting: false,
      placeholder: "Ask anything",
      onSubmit: vi.fn(async () => true),
      onStop: vi.fn(),
    };
    try {
      const container = render(React.createElement(AgentComposer, { ...props, draft: "a" }));
      act(() => root?.render(withTestLocalization(React.createElement(AgentComposer, { ...props, draft: "ab" }))));
      act(() => root?.render(withTestLocalization(React.createElement(AgentComposer, { ...props, draft: "abc" }))));
      expect(constructions).toBe(1);
      expect(container.querySelectorAll(".cm-editor")).toHaveLength(1);
    } finally {
      globalThis.ResizeObserver = OriginalResizeObserver;
    }
  });

  it("keeps a useful placeholder when the caller supplies blank copy", () => {
    const container = render(React.createElement(AgentComposer, {
      draft: "",
      onDraftChange: vi.fn(),
      disabled: false,
      running: false,
      stopping: false,
      submitting: false,
      placeholder: "   ",
      onSubmit: vi.fn(async () => true),
      onStop: vi.fn(),
    }));

    expect(container.querySelector(".cm-content")?.getAttribute("aria-placeholder")).toBe("Ask about this project");
    const sendButton = container.querySelector(
      'button[aria-label="Send message"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).not.toBeNull();
    expect(sendButton?.disabled).toBe(true);
  });

  it("morphs the single send action into stop while a turn is running", () => {
    const onStop = vi.fn();
    const props = {
      draft: "Follow up",
      onDraftChange: vi.fn(),
      disabled: false,
      running: true,
      stopping: false,
      submitting: false,
      runtimeLabel: "Codex",
      steerAvailable: true,
      queueAvailable: true,
      onSubmit: vi.fn(async () => true),
      onStop,
    };
    const container = render(React.createElement(AgentComposer, props));

    const actions = container.querySelectorAll(".desktop-agent-composer-action");
    expect(actions).toHaveLength(1);
    const stopAction = actions[0] as HTMLButtonElement;
    expect(stopAction.classList.contains("is-stop")).toBe(true);
    expect(stripBidiIsolation(stopAction.getAttribute("aria-label"))).toBe(testT("agent.composer.stop", { agent: "Codex" }));
    expect(container.querySelector(`button[aria-label="${testT("agent.composer.send")}"]`)).toBeNull();

    act(() => stopAction.click());
    expect(onStop).toHaveBeenCalledTimes(1);

    act(() => root?.render(withTestLocalization(React.createElement(AgentComposer, { ...props, stopping: true }))));
    const stoppingAction = container.querySelector(".desktop-agent-composer-action") as HTMLButtonElement;
    expect(stoppingAction.getAttribute("aria-busy")).toBe("true");
    expect(stoppingAction.disabled).toBe(true);
  });
});
