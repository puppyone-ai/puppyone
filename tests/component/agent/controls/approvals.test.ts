/** @vitest-environment happy-dom */

import React from "react";

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { AgentApprovalDock } from "../../../../src/features/desktop-agent/ui/AgentApprovalDock";

import { render } from "../../../support/agent/rendererHarness";

describe("Desktop Agent renderer surfaces", () => {

  it("disables approval actions while a decision is resolving", () => {
    const onResolve = vi.fn();
    const container = render(React.createElement(AgentApprovalDock, {
      approval: {
        requestId: "req-1",
        turnId: "turn-1",
        itemId: "item-1",
        kind: "command",
        title: "Run npm test",
        command: "npm test",
        cwd: "/workspace",
        commandActions: [],
        networkApprovalContext: null,
        grantRoot: null,
        policyChangeRequested: false,
        reason: null,
        availableDecisions: ["accept", "decline", "cancel"],
        sequence: 1,
      },
      queueLength: 1,
      resolving: true,
      onResolve,
    }));
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    const card = container.querySelector(".desktop-agent-approval");
    expect(card?.getAttribute("data-state")).toBe("resolving");
    expect(card?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector(".desktop-agent-approval-status")?.textContent).toBe("Submitting…");
  });

  it("keeps approval copy concise and preserves every provider decision", () => {
    const onResolve = vi.fn();
    const repeatedCopy = "Web search: early collaborative editor launch history";
    const container = render(React.createElement(AgentApprovalDock, {
      approval: {
        requestId: "req-search",
        turnId: "turn-1",
        itemId: "item-1",
        kind: "command",
        title: repeatedCopy,
        command: null,
        cwd: null,
        commandActions: [],
        networkApprovalContext: null,
        grantRoot: null,
        policyChangeRequested: false,
        reason: `  ${repeatedCopy}  `,
        availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
        sequence: 1,
      },
      queueLength: 1,
      resolving: false,
      onResolve,
    }));

    expect(container.textContent?.split(repeatedCopy)).toHaveLength(2);
    expect(container.querySelector(".desktop-agent-approval-title")?.textContent).toBe(repeatedCopy);
    expect(container.querySelector(".desktop-agent-approval-heading strong")).toBeNull();
    expect(container.querySelector(".desktop-agent-approval-status")?.textContent).toBe("Needs your approval");
    expect(container.querySelector(".desktop-agent-approval")?.getAttribute("data-state")).toBe("waiting");
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    expect(buttons.map((button) => button.textContent)).toEqual(["Deny", "Allow for session", "Allow once"]);
    expect(buttons[0].classList.contains("is-quiet")).toBe(true);
    act(() => buttons[0].click());
    act(() => buttons[1].click());
    act(() => buttons[2].click());
    expect(onResolve.mock.calls.map(([decision]) => decision)).toEqual(["decline", "acceptForSession", "accept"]);
  });

  it("shows the queue count instead of a redundant waiting label for multiple approvals", () => {
    const container = render(React.createElement(AgentApprovalDock, {
      approval: {
        requestId: "req-queue",
        turnId: "turn-1",
        itemId: "item-1",
        kind: "command",
        title: "Search the web",
        command: null,
        cwd: null,
        commandActions: [],
        networkApprovalContext: null,
        grantRoot: null,
        policyChangeRequested: false,
        reason: null,
        availableDecisions: ["accept", "decline", "cancel"],
        sequence: 1,
      },
      queueLength: 3,
      resolving: false,
      onResolve: vi.fn(),
    }));

    expect(container.querySelector(".desktop-agent-approval-status")?.textContent).toBe("3 pending");
  });

  it("renders material network and filesystem approval scope", () => {
    const container = render(React.createElement(AgentApprovalDock, {
      approval: {
        requestId: "req-network",
        turnId: "turn-1",
        itemId: "item-1",
        kind: "command",
        title: "Allow network access",
        command: null,
        cwd: "/workspace",
        commandActions: [],
        networkApprovalContext: { host: "registry.npmjs.org:443", protocol: "https" },
        grantRoot: "/workspace/generated",
        policyChangeRequested: true,
        reason: "Download a package",
        availableDecisions: ["accept", "decline", "cancel"],
        sequence: 1,
      },
      queueLength: 1,
      resolving: false,
      onResolve: vi.fn(),
    }));

    expect(container.textContent).toContain("https://registry.npmjs.org:443");
    expect(container.textContent).toContain("/workspace/generated");
    expect(container.textContent).toContain("reusable policy change");
  });
});
