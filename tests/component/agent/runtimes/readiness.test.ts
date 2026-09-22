/** @vitest-environment happy-dom */

import React from "react";

import { describe, expect, it, vi } from "vitest";

import { AgentPanelStatus } from "../../../../src/features/desktop-agent/ui/AgentPanelStatus";

import type { AgentRuntimeReadiness } from "../../../../src/features/desktop-agent/agentTypes";
import { stripBidiIsolation } from "../../../support/react/localization";
import { render } from "../../../support/agent/rendererHarness";

describe("Desktop Agent renderer surfaces", () => {
  it.each(['automatic', 'paused', 'exhausted'] as const)('keeps display recovery and termination actionable when %s', policy => {
    const onPauseRecovery = vi.fn();
    const onRetryRecovery = vi.fn();
    const onManageExecutions = vi.fn();
    const container = render(React.createElement(AgentPanelStatus, {
      unavailable: false, failed: true, error: { code: 'event-gap' }, runtimeLabel: 'Agent', onRetry: vi.fn(),
      recovery: { policy, attempt: 2, maxAttempts: 5 }, onPauseRecovery, onRetryRecovery, onManageExecutions,
    }));
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    const buttons = Array.from(container.querySelectorAll('button'));
    buttons.find(button => button.textContent === 'Retry message sync')!.click();
    buttons.find(button => button.textContent === 'Manage / terminate instance')!.click();
    expect(onRetryRecovery).toHaveBeenCalledOnce();
    expect(onManageExecutions).toHaveBeenCalledOnce();
    const pause = buttons.find(button => button.textContent === 'Pause automatic recovery');
    expect(Boolean(pause)).toBe(policy === 'automatic');
    pause?.click();
    expect(onPauseRecovery).toHaveBeenCalledTimes(policy === 'automatic' ? 1 : 0);
    if (policy === 'automatic') expect(container.textContent).toContain('attempt 2 of 5');
  });
  it.each([
    [
      "explicit sign-out",
      { status: "installed-not-authenticated" as const, code: "AUTHENTICATION_REQUIRED" as const },
      "Sign in to Cursor Agent",
    ],
    [
      "status probe failure",
      { status: "error" as const, code: "AUTHENTICATION_PROBE_CRASHED" as const },
      "Cursor Agent sign-in check crashed",
    ],
  ])("renders %s from the structured readiness code", (_label, reason, heading) => {
    const container = render(React.createElement(AgentPanelStatus, {
      unavailable: true,
      failed: false,
      error: null,
      runtimeLabel: "Cursor Agent",
      readiness: {
        runtimeId: "cursor",
        provider: "cursor",
        ...reason,
        version: "2026.08.1",
        minimumVersion: null,
        message: "Structured backend detail.",
      },
      onRetry: vi.fn(),
    }));

    const text = stripBidiIsolation(container.textContent);
    expect(text).toContain(heading);
    expect(text).toContain(`Status code: ${reason.code}`);
    if (reason.code === "AUTHENTICATION_PROBE_CRASHED") expect(text).not.toContain("Sign in to Cursor Agent");
  });

  it("keeps incompatible runtime recovery product-owned", () => {
    const readiness: AgentRuntimeReadiness = {
      runtimeId: "opencode",
      provider: "opencode",
      status: "unsupported-version",
      code: "RUNTIME_VERSION_UNSUPPORTED",
      version: "0.100.0",
      minimumVersion: "0.144.1",
      message: "The managed Agent engine is incompatible with this PuppyOne build.",
    };
    const container = render(React.createElement("div", {
      className: "desktop-agent-readiness",
      role: "status",
      children: [
        React.createElement("strong", { key: "h" }, "Built-in Agent needs repair"),
        React.createElement("p", { key: "p" },
          `${readiness.message} Update or reinstall PuppyOne, then retry.`,
        ),
      ],
    }));
    expect(container.textContent).toContain("Built-in Agent needs repair");
    expect(container.textContent).toContain("Update or reinstall PuppyOne");
    expect(container.textContent).not.toContain("Update OpenCode");
  });
});
