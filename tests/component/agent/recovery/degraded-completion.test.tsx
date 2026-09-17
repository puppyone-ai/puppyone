/** @vitest-environment happy-dom */

import React from "react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { AgentRecoverySurface } from "../../../../src/features/desktop-agent/ui/AgentRecoverySurface";
import { render } from "../../../support/agent/rendererHarness";

describe("Agent degraded-completion recovery", () => {
  it("offers an explicit continuation and bounded provider-neutral details", () => {
    const onContinue = vi.fn();
    const container = render(<AgentRecoverySurface
      recovery={{
        kind: "degraded-completion",
        failureScope: "upstream-request",
        code: "CURSOR_HTTP2_STREAM_CANCEL",
        retryable: true,
        transportHealth: "healthy",
        sideEffects: "possible",
      }}
      runtimeLabel="Cursor Agent"
      submitting={false}
      onContinue={onContinue}
    />);

    expect(container.textContent).toContain("Task needs follow-up");
    expect(container.textContent).toContain("Completed file changes are kept");
    expect(container.querySelector("code")).toBeNull();
    const buttons = [...container.querySelectorAll("button")];
    const details = buttons.find((button) => button.textContent === "View details")!;
    const continueButton = buttons.find((button) => button.textContent === "Check current state and continue")!;
    act(() => details.click());
    expect(container.querySelector("code")?.textContent).toBe("CURSOR_HTTP2_STREAM_CANCEL");
    expect(container.textContent).toContain("Connected");
    act(() => continueButton.click());
    expect(onContinue).toHaveBeenCalledOnce();
  });
});
