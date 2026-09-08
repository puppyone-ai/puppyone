/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuxiliaryWorkbenchHistoryTarget } from "../src/features/app-shell/auxiliary-workbench/types";
import {
  AGENT_HISTORY_CATALOG_TIMEOUT_MS,
  AGENT_HISTORY_RUNTIME_TIMEOUT_MS,
} from "../src/features/desktop-agent/ui/useAgentConversationHistory";
import { AgentChatHistoryBrowser } from "../src/features/desktop-agent/workbench/AgentChatHistoryBrowser";
import { withTestLocalization } from "./testLocalization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  vi.useRealTimers();
  root = null;
  document.body.replaceChildren();
  delete (window as Window & { puppyoneDesktop?: unknown }).puppyoneDesktop;
});

describe("Agent Chat global history browser", () => {
  it("shows partial source coverage and unsupported lookup separately from an empty history", async () => {
    const codex = runtime("codex", "Codex");
    const cursor = runtime("cursor", "Cursor");
    const saved = session("saved", codex.descriptor, "Available conversation", "gpt-5.6-sol");
    Object.defineProperty(window, "puppyoneDesktop", { configurable: true, value: {
      discoverAgentProviders: vi.fn(async () => ({ ...emptyInspection(), runtimes: [codex, cursor] })),
      listAgentSessions: vi.fn(async ({ discoverNative, runtimeId }: { discoverNative?: boolean; runtimeId?: string }) => {
        if (!discoverNative) return emptySessionList();
        return { ...emptySessionList(), sessions: runtimeId === "codex" ? [saved] : [],
          catalogCoverage: { truncated: true, capacity: 500, retained: 500 },
          discovery: { runtimeId, status: runtimeId === "codex" ? "complete" : "unsupported",
            coverage: "unknown", indexed: 1, nextCursor: null, scanId: null, warnings: [] } };
      }),
      onAgentEvent: vi.fn(() => () => undefined), onAgentSessionExit: vi.fn(() => () => undefined),
    } });
    const container = mountHistoryBrowser();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(container.textContent).toContain("Available conversation");
    expect(container.textContent).toContain("Codex: This Agent cannot confirm that its history list is complete.");
    expect(container.textContent).toContain("Cursor: History lookup is not supported.");
    expect(container.textContent).toContain("The local history limit was reached.");
    expect(container.textContent).not.toContain("No chat history");
  });

  it("does not discover history before the user acknowledges local history access", async () => {
    const discoverAgentProviders = vi.fn(async () => emptyInspection());
    const listAgentSessions = vi.fn(async () => emptySessionList());
    Object.defineProperty(window, "puppyoneDesktop", {
      configurable: true,
      value: {
        discoverAgentProviders,
        listAgentSessions,
        onAgentEvent: vi.fn(() => () => undefined),
        onAgentSessionExit: vi.fn(() => () => undefined),
      },
    });
    const onHistoryDiscoveryEnabledChange = vi.fn();
    const container = mountHistoryBrowser({
      historyDiscoveryEnabled: false,
      onHistoryDiscoveryEnabledChange,
    });

    expect(container.textContent).toContain("Allow PuppyOne to discover chat history from local Agents?");
    expect(container.querySelector(".desktop-agent-history-permission-view")).not.toBeNull();
    expect(container.querySelector(".desktop-dialog-backdrop")).toBeNull();
    await act(async () => Promise.resolve());
    expect(discoverAgentProviders).not.toHaveBeenCalled();
    expect(listAgentSessions).not.toHaveBeenCalled();

    act(() => container.querySelector<HTMLButtonElement>(".desktop-agent-history-permission-button")?.click());
    expect(onHistoryDiscoveryEnabledChange).toHaveBeenCalledWith(true);
  });

  it("keeps the empty catalog loading until runtime inspection has settled", async () => {
    vi.useFakeTimers();
    const listAgentSessions = vi.fn(async () => emptySessionList());
    Object.defineProperty(window, "puppyoneDesktop", {
      configurable: true,
      value: {
        discoverAgentProviders: vi.fn(() => new Promise(() => {})),
        listAgentSessions,
        onAgentEvent: vi.fn(() => () => undefined),
        onAgentSessionExit: vi.fn(() => () => undefined),
      },
    });
    const container = mountHistoryBrowser();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(listAgentSessions).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Loading chat history");
    expect(container.textContent).not.toContain("No chat history");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_HISTORY_RUNTIME_TIMEOUT_MS);
    });
    expect(container.textContent).not.toContain("Loading chat history");
    expect(container.textContent).not.toContain("No chat history");
    expect(container.textContent).toContain("Some chat history could not be refreshed.");
  });

  it("does not show an empty state while the initial native history scan is running", async () => {
    const codex = runtime("codex", "Codex");
    const saved = session("saved-codex", codex.descriptor, "Recovered chat", "gpt-5.6-sol");
    let catalogCalls = 0;
    const nativePage = deferred<ReturnType<typeof emptySessionList>>();
    const listAgentSessions = vi.fn((request: { discoverNative?: boolean }) => {
      if (request.discoverNative) return nativePage.promise;
      catalogCalls += 1;
      return Promise.resolve(catalogCalls === 1
        ? emptySessionList()
        : { ...emptySessionList(), sessions: [saved] });
    });
    Object.defineProperty(window, "puppyoneDesktop", {
      configurable: true,
      value: {
        discoverAgentProviders: vi.fn(async () => ({
          ...emptyInspection(),
          runtimes: [codex],
        })),
        listAgentSessions,
        onAgentEvent: vi.fn(() => () => undefined),
        onAgentSessionExit: vi.fn(() => () => undefined),
      },
    });
    const container = mountHistoryBrowser();

    await vi.waitFor(() => expect(listAgentSessions).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: "codex",
      discoverNative: true,
    })));
    expect(container.textContent).toContain("Loading chat history");
    expect(container.textContent).not.toContain("No chat history");

    await act(async () => {
      nativePage.resolve({
        ...emptySessionList(),
        sessions: [saved],
        discovery: {
          runtimeId: "codex",
          status: "complete",
          nextCursor: null,
          scanId: null,
          indexed: 1,
          warnings: [],
        },
      });
      await nativePage.promise;
    });
    await vi.waitFor(() => expect(container.textContent).toContain("Recovered chat"));
    expect(container.textContent).not.toContain("Loading chat history");
    expect(container.textContent).not.toContain("No chat history");
  });

  it("ends loading with a recoverable error when the local catalog IPC stalls", async () => {
    vi.useFakeTimers();
    const listAgentSessions = vi.fn(() => new Promise(() => {}));
    Object.defineProperty(window, "puppyoneDesktop", {
      configurable: true,
      value: {
        discoverAgentProviders: vi.fn(async () => emptyInspection()),
        listAgentSessions,
        onAgentEvent: vi.fn(() => () => undefined),
        onAgentSessionExit: vi.fn(() => () => undefined),
      },
    });
    const container = mountHistoryBrowser();

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(AGENT_HISTORY_CATALOG_TIMEOUT_MS);
    });

    expect(listAgentSessions).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain("Loading chat history");
    expect(container.textContent).not.toContain("No chat history");
    expect(container.textContent).toContain("Some chat history could not be refreshed.");
  });

  it("keeps a saved session actionable while its runtime readiness is unavailable", async () => {
    const cursor = runtime("cursor", "Cursor Agent");
    cursor.readiness.status = "installed-not-authenticated";
    const saved = session("saved-cursor", cursor.descriptor, "Design review", "default");
    Object.defineProperty(window, "puppyoneDesktop", {
      configurable: true,
      value: {
        discoverAgentProviders: vi.fn(async () => ({
          ...emptyInspection(),
          runtimes: [cursor],
        })),
        listAgentSessions: vi.fn(async () => ({
          ...emptySessionList(),
          sessions: [saved],
        })),
        onAgentEvent: vi.fn(() => () => undefined),
        onAgentSessionExit: vi.fn(() => () => undefined),
      },
    });
    const onOpen = vi.fn();
    const container = mountHistoryBrowser({ onOpen });

    const option = await vi.waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('button[aria-label="Open Design review"]');
      expect(button).not.toBeNull();
      return button!;
    });
    expect(option.disabled).toBe(false);
    expect(option.querySelector(".desktop-agent-history-meta")).toBeNull();
    expect(option.querySelector(".desktop-agent-brand-mark.is-cursor.is-monochrome")).not.toBeNull();
    expect(option.textContent).not.toContain("default");
    expect(container.querySelector(".desktop-agent-history-list")?.getAttribute("data-po-scrollbar"))
      .toBe("sidebar");

    act(() => option.click());
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "saved-cursor" }));
  });

  it("loads local locators, scans ready Harnesses independently, and returns an opaque restore target", async () => {
    const codex = runtime("codex", "Codex");
    const claude = runtime("claude", "Claude Code");
    const saved = session("saved-codex", codex.descriptor, "Fix authentication", "gpt-5.6-sol");
    const listAgentSessions = vi.fn(async (request: { runtimeId?: string; discoverNative?: boolean }) => {
      if (request.runtimeId === "claude" && request.discoverNative) {
        throw new Error("Claude history unavailable");
      }
      return {
        sessions: [saved],
        discovery: {
          runtimeId: request.runtimeId ?? null,
          status: request.discoverNative ? "complete" : "not-requested",
          nextCursor: null,
          scanId: null,
          indexed: request.discoverNative ? 1 : 0,
          warnings: [],
        },
        warnings: [],
      };
    });
    Object.defineProperty(window, "puppyoneDesktop", {
      configurable: true,
      value: {
        discoverAgentProviders: vi.fn(async () => ({
          runtimes: [codex, claude],
          selectedRuntimeId: null,
          runtime: null,
          readiness: null,
          account: null,
          providers: [],
          models: [],
          modes: [],
          commands: [],
          capabilities: null,
          warnings: [],
        })),
        resumeAgentSession: vi.fn(async () => null),
        openAgentSession: vi.fn(async () => ({
          status: "failed",
          error: { code: "SESSION_NOT_FOUND", message: "Unavailable", retryable: false },
        })),
        listAgentSessions,
        onAgentEvent: vi.fn(() => () => undefined),
        onAgentSessionExit: vi.fn(() => () => undefined),
      },
    });
    const onOpen = vi.fn();
    const onBack = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(withTestLocalization(
        <AgentChatHistoryBrowser
          instanceId="history-test"
          rootId="workspace-a"
          rootPath="/workspace/a"
          excludedResourceIds={[]}
          openingTargetId={null}
          historyDiscoveryEnabled
          onHistoryDiscoveryEnabledChange={() => {}}
          onBack={onBack}
          onOpen={onOpen}
        />,
      ));
      await Promise.resolve();
    });

    expect(container.querySelector(".desktop-agent-boundary.desktop-agent-runtime-launcher.is-history"))
      .not.toBeNull();

    await vi.waitFor(() => {
      expect(listAgentSessions).toHaveBeenCalledWith(expect.objectContaining({
        rootPath: "/workspace/a",
        discoverNative: false,
      }));
      expect(listAgentSessions).toHaveBeenCalledWith(expect.objectContaining({
        runtimeId: "codex",
        discoverNative: true,
      }));
      expect(listAgentSessions).toHaveBeenCalledWith(expect.objectContaining({
        runtimeId: "claude",
        discoverNative: true,
      }));
    });

    const savedButton = await vi.waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Open Fix authentication"]',
      );
      expect(button).not.toBeNull();
      return button!;
    });
    expect(savedButton.textContent).not.toContain("gpt-5.6-sol");
    expect(savedButton.textContent).not.toContain("Codex");
    expect(savedButton.disabled).toBe(false);
    act(() => savedButton.click());
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({
      id: "saved-codex",
      title: "Fix authentication",
      payload: {
        kind: "agent-session",
        runtimeId: "codex",
        sessionId: "saved-codex",
      },
    }));

    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Back to Agents"]')?.click());
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("keeps an opaque native scan epoch attached to every pagination request", async () => {
    const cursor = runtime("cursor", "Cursor Agent");
    const listAgentSessions = vi.fn(async (request: {
      runtimeId?: string;
      discoverNative?: boolean;
      cursor?: string;
      scanId?: string;
    }) => {
      if (!request.discoverNative) return emptySessionList();
      if (!request.cursor) {
        return {
          ...emptySessionList(),
          discovery: {
            runtimeId: "cursor",
            status: "partial",
            nextCursor: "provider-page-2",
            scanId: "scan-epoch-a",
            indexed: 1,
            warnings: [],
          },
        };
      }
      return {
        ...emptySessionList(),
        discovery: {
          runtimeId: "cursor",
          status: "complete",
          nextCursor: null,
          scanId: null,
          indexed: 1,
          warnings: [],
        },
      };
    });
    Object.defineProperty(window, "puppyoneDesktop", {
      configurable: true,
      value: {
        discoverAgentProviders: vi.fn(async () => ({
          ...emptyInspection(),
          runtimes: [cursor],
        })),
        listAgentSessions,
        onAgentEvent: vi.fn(() => () => undefined),
        onAgentSessionExit: vi.fn(() => () => undefined),
      },
    });
    const container = mountHistoryBrowser();

    const loadMore = await vi.waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>(".desktop-agent-history-more");
      expect(button).not.toBeNull();
      return button!;
    });
    act(() => loadMore.click());

    await vi.waitFor(() => expect(listAgentSessions).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: "cursor",
      discoverNative: true,
      cursor: "provider-page-2",
      scanId: "scan-epoch-a",
    })));
  });
});

function mountHistoryBrowser({
  onOpen = () => {},
  historyDiscoveryEnabled = true,
  onHistoryDiscoveryEnabledChange = () => {},
}: {
  onOpen?: (target: AuxiliaryWorkbenchHistoryTarget) => void;
  historyDiscoveryEnabled?: boolean;
  onHistoryDiscoveryEnabledChange?: (enabled: boolean) => void;
} = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(withTestLocalization(
      <AgentChatHistoryBrowser
        instanceId="history-test"
        rootId="workspace-a"
        rootPath="/workspace/a"
        excludedResourceIds={[]}
        openingTargetId={null}
        historyDiscoveryEnabled={historyDiscoveryEnabled}
        onHistoryDiscoveryEnabledChange={onHistoryDiscoveryEnabledChange}
        onBack={() => {}}
        onOpen={onOpen}
      />,
    ));
  });
  return container;
}

function emptyInspection() {
  return {
    runtimes: [],
    selectedRuntimeId: null,
    runtime: null,
    readiness: null,
    account: null,
    providers: [],
    models: [],
    modes: [],
    commands: [],
    capabilities: null,
    warnings: [],
  };
}

function emptySessionList() {
  return {
    sessions: [],
    discovery: {
      runtimeId: null,
      status: "not-requested",
      nextCursor: null,
      scanId: null,
      indexed: 0,
      warnings: [],
    },
    warnings: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function runtime(id: string, displayName: string) {
  return {
    descriptor: {
      id,
      displayName,
      iconKey: id,
      kind: "specialized-native",
      ownership: { session: "runtime" },
    },
    readiness: {
      runtimeId: id,
      provider: id,
      status: "ready",
      code: "ready",
      version: "1.0.0",
      minimumVersion: null,
      message: "Ready",
    },
  };
}

function session(
  id: string,
  runtimeDescriptor: ReturnType<typeof runtime>["descriptor"],
  title: string,
  selectedModel: string,
) {
  return {
    id,
    runtimeId: runtimeDescriptor.id,
    runtime: runtimeDescriptor,
    provider: runtimeDescriptor.id,
    providerSessionId: id,
    workspaceRoot: "/workspace/a",
    title,
    createdAt: "2026-08-28T10:00:00.000Z",
    updatedAt: "2026-08-29T10:00:00.000Z",
    terminalState: "idle",
    selectedModel,
    lastSequence: 0,
    origin: "native-discovery",
  };
}
