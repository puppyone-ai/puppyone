/** @vitest-environment happy-dom */
import React, { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AgentConversationHistory } from "../../../../src/features/desktop-agent/ui/AgentConversationHistory";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
});
type Props = ComponentProps<typeof AgentConversationHistory>;
const source = { runtimeId: "codex", status: "complete", coverage: "complete", indexed: 0, nextCursor: null, scanId: null, warnings: [] } as const;
function mount(overrides: Partial<Props> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const props: Props = { sessions: [], runtimes: [], sources: { codex: source }, loading: false, refreshing: false,
    loadingMore: false, hasMore: false, error: null, onOpen: vi.fn(), onRefresh: vi.fn(), onLoadMore: vi.fn(), onBack: vi.fn(), ...overrides };
  const render = (patch: Partial<Props> = {}) => act(() => root.render(withTestLocalization(<AgentConversationHistory {...props} {...patch} />)));
  render();
  return { container, props, render };
}

it.each([
  [{}, "No chat history"],
  [{ sources: {} }, "No restorable chats found in this project yet"],
  [{ sources: { codex: { ...source, coverage: "unknown" } } }, "No restorable chats found in this project yet"],
  [{ sources: { codex: { ...source, coverage: undefined } } }, "No restorable chats found in this project yet"],
  [{ sources: { codex: { ...source, status: "unsupported" } } }, "No restorable chats found in this project yet"],
  [{ sources: { codex: { ...source, status: "partial" } } }, "No restorable chats found in this project yet"],
  [{ catalogTruncated: true }, "No restorable chats found in this project yet"],
  [{ hasMore: true }, "No restorable chats found in this project yet"],
  [{ excludedSessionCount: 2 }, "Discovered chats are already open"],
  [{ excludedSessionCount: 2, sources: { codex: { ...source, coverage: "unknown" } } }, "Discovered chats are already open"],
  [{ error: "timeout" }, "Some chat history could not be refreshed."],
  [{ sources: { codex: { ...source, status: "failed" } } }, "Some chat history could not be refreshed."],
  [{ loading: true }, "Loading chat history"],
] satisfies [Partial<Props>, string][]) ("distinguishes empty result evidence %j", (options, expected) => {
  const { container } = mount(options);
  expect(container.querySelector(".desktop-agent-history-empty")?.textContent).toBe(expected);
});

it("discloses capability limits without presenting them as a query failure", () => {
  const { container } = mount({ sources: { codex: { ...source, coverage: "unknown" } } });
  expect(container.querySelector("details")?.open).toBe(false);
  expect(container.querySelector("summary")?.textContent).toBe("History lookup is limited");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("This Agent cannot confirm that its history list is complete.");
});

it("puts search in the toolbar, preserves rows on refresh and scopes Escape to the focused history", () => {
  const sessions = [{ id: "saved", runtimeId: "codex", provider: "codex", providerSessionId: "native", workspaceRoot: "/workspace",
    title: "Saved design", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" }] as Props["sessions"];
  const first = mount({ sessions });
  const second = mount();
  expect(first.container.querySelector("h2")).toBeNull();
  expect(first.container.querySelector('input[type="search"]')).toBeNull();
  act(() => first.container.querySelector<HTMLButtonElement>('button[aria-label="Search chat history"]')!.click());
  const input = first.container.querySelector<HTMLInputElement>('input[type="search"]')!;
  expect(input.closest("header")).not.toBeNull();
  expect(document.activeElement).toBe(input);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "missing");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(first.container.textContent).toContain("No matching chats");
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(first.container.querySelector('input[type="search"]')).toBeNull();
  expect(first.container.textContent).toContain("Saved design");
  expect(first.props.onBack).not.toHaveBeenCalled();
  expect(second.props.onBack).not.toHaveBeenCalled();
  first.render({ refreshing: true, error: "source unavailable" });
  expect(first.container.textContent).toContain("Saved design");
  expect(first.container.querySelector<HTMLButtonElement>('button[aria-label="Open Saved design"]')?.disabled).toBe(false);
  expect(first.container.querySelector<HTMLButtonElement>('button[aria-label="Refresh chat history"]')?.disabled).toBe(true);
  act(() => first.container.querySelector('button[aria-label="Back to Agents"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(first.props.onBack).toHaveBeenCalledOnce();
  expect(second.props.onBack).not.toHaveBeenCalled();
});
