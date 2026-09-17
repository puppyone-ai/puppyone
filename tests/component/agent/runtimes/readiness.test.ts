/** @vitest-environment happy-dom */

import React from "react";

import { describe, expect, it, vi } from "vitest";

import { AgentPanelStatus } from "../../../../src/features/desktop-agent/ui/AgentPanelStatus";

import type { AgentRuntimeReadiness } from "../../../../src/features/desktop-agent/agentTypes";
import { stripBidiIsolation } from "../../../support/react/localization";
import { render } from "../../../support/agent/rendererHarness";

describe("Desktop Agent renderer surfaces", () => {
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
        React.createElement("strong", { key: "h" }, "Workspace Agent needs repair"),
        React.createElement("p", { key: "p" },
          `${readiness.message} Update or reinstall PuppyOne, then retry.`,
        ),
      ],
    }));
    expect(container.textContent).toContain("Workspace Agent needs repair");
    expect(container.textContent).toContain("Update or reinstall PuppyOne");
    expect(container.textContent).not.toContain("Update OpenCode");
  });
});
