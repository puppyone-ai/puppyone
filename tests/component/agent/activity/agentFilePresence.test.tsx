/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentActivityEvent } from "../../../../shared/agent-activity-contract/types";
import type { AgentActivityClient } from "../../../../src/features/desktop-agent-presence/application/agentActivityClient";
import { AgentActivityStore } from "../../../../src/features/desktop-agent-presence/application/agentActivityStore";
import { AgentFilePresence } from "../../../../src/features/desktop-agent-presence/ui/AgentFilePresence";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let store: AgentActivityStore | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  store?.dispose();
  root = null;
  store = null;
  document.body.replaceChildren();
});

describe("Agent file presence", () => {
  it("renders the Codex eye for reads and the Agent hand for writes", () => {
    const client: AgentActivityClient = {
      subscribe: async () => ({ schemaVersion: 1, activities: [] }),
      onEvent: () => () => undefined,
      unsubscribe: () => undefined,
    };
    const activityStore = new AgentActivityStore(client);
    store = activityStore;
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(
      <AgentFilePresence path="notes.md" store={activityStore} />,
    ));

    act(() => store?.apply(activity({
      activityId: "read",
      providerId: "codex",
      operation: "file.read",
      access: "read",
    })));
    expect(presence().textContent).toContain("Codex");
    expect(presence().getAttribute("aria-label")).toBe("Codex is reading this file");
    expect(presence().getAttribute("data-kind")).toBe("reading");
    expect(presence().querySelector(".lucide-eye")).not.toBeNull();

    act(() => store?.apply(activity({
      activityId: "write",
      providerId: "claude",
      operation: "file.write",
      access: "write",
    })));
    expect(presence().textContent).toContain("Claude Code");
    expect(presence().getAttribute("aria-label")).toBe("Claude Code is writing this file");
    expect(presence().getAttribute("data-kind")).toBe("writing");
    expect(presence().querySelector(".lucide-hand")).not.toBeNull();
  });
});

function presence() {
  const element = document.querySelector<HTMLElement>(".desktop-agent-file-presence");
  if (!element) throw new Error("missing Agent file presence");
  return element;
}

function activity({
  activityId,
  providerId,
  operation,
  access,
}: {
  activityId: string;
  providerId: string;
  operation: "file.read" | "file.write";
  access: "read" | "write";
}): AgentActivityEvent {
  return {
    schemaVersion: 1,
    eventId: `event-${activityId}`,
    activityId,
    providerId,
    terminalSessionId: "terminal-1",
    phase: "started",
    operation,
    targets: [{ workspaceRelativePath: "notes.md", access, confidence: "exact" }],
    occurredAt: Date.now(),
  };
}
