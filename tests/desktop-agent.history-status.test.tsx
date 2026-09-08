/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSessionActor } from "../electron/main/agent/domain/agent-session-actor.mjs";
import { createAgentProjection } from "./helpers/agentDisplayFixture";
import { AgentTranscript } from "../src/features/desktop-agent/ui/AgentTranscript";
import { TerminalWorkbenchCreationFailure } from "../src/features/desktop-terminal/workbench/TerminalWorkbenchCreationFailure";
import { withTestLocalization } from "./testLocalization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); });
function render(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(withTestLocalization(element)));
  return container;
}

describe("Chat history notices", () => {
  it("does not show a history warning for a local event replay gap alone", () => {
    const display = createAgentProjection();
    display.missingRanges = [{ from: 1, to: 42 }];
    const container = render(<AgentTranscript projection={display} loading={false} />);
    expect(container.querySelector("[data-history-notice]")).toBeNull();
    expect(container.textContent).not.toContain("no longer available");
  });

  it("shows an expandable neutral explanation for unknown coverage and clears it after recovery", () => {
    const actor = new AgentSessionActor({ sequence: 42 });
    actor.dispatch({ type: "history.loaded", coverage: "unknown", reason: "replay-unverified" });
    const container = render(<AgentTranscript projection={actor.display} loading={false} />);
    const notice = container.querySelector<HTMLDetailsElement>("details[data-history-notice='unknown']");
    expect(notice?.querySelector("summary")?.textContent).toBe("Some history messages may not be shown.");
    expect(notice?.querySelector("p")?.textContent).toContain("does not confirm");
    expect(notice?.open).toBe(false);
    expect(notice?.querySelector("[role='alert']")).toBeNull();
    actor.dispatch({ type: "history.loaded", coverage: "complete" });
    act(() => root?.render(withTestLocalization(<AgentTranscript projection={actor.display} loading={false} />)));
    expect(container.querySelector("[data-history-notice]")).toBeNull();
  });

  it.each([
    ["partial", false, "Only part of this conversation is shown."],
    ["complete", true, "Showing recent messages."],
  ] as const)("distinguishes %s native coverage from display truncation %s", (coverage, truncated, message) => {
    const display = createAgentProjection();
    display.history = { coverage, reason: coverage === "partial" ? "read-limit" : null };
    display.displayWindow = { truncated };
    const container = render(<AgentTranscript projection={display} loading={false} />);
    expect(container.querySelector("summary")?.textContent).toBe(message);
    expect(container.querySelector("[data-history-notice] button")).toBeNull();
  });

  it("offers retry for a history read error and no retry for confirmed missing history", () => {
    const retry = vi.fn();
    const failure = { kind: "agent-chat", label: "Agent Chat", code: "HISTORY_READ_FAILED", detail: null, retryable: true };
    const container = render(<TerminalWorkbenchCreationFailure failure={failure} onDismiss={() => {}} onRetry={retry} />);
    expect(container.textContent).toContain("History messages could not be loaded. Try again.");
    act(() => container.querySelector<HTMLButtonElement>("button[aria-label='Retry']")?.click());
    expect(retry).toHaveBeenCalledOnce();
    act(() => root?.render(withTestLocalization(<TerminalWorkbenchCreationFailure
      failure={{ ...failure, code: "SESSION_NOT_FOUND", retryable: false }} onDismiss={() => {}} onRetry={retry}
    />)));
    expect(container.textContent).toContain("This saved chat is no longer available.");
    expect(container.querySelector("button[aria-label='Retry']")).toBeNull();
  });
});
