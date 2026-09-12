/** @vitest-environment happy-dom */

import React from "react";

import { act } from "react";
import { describe, expect, it } from "vitest";

import { AgentTranscript } from "../../../../src/features/desktop-agent/ui/AgentTranscript";

import { createAgentProjection } from "../../../support/agent/agentDisplayFixture";

import { render } from "../../../support/agent/rendererHarness";

describe("Desktop Agent renderer surfaces", () => {

  it("shows Jump to latest when the transcript is not pinned to the bottom", () => {
    const projection = createAgentProjection();
    projection.messages.push({
      id: "msg-1",
      role: "assistant",
      text: "hello".repeat(200),
      sequence: 1,
      turnId: "turn-1",
      itemId: "item-1",
      streaming: false,
      terminalState: null,
    });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 800 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 200 });
    Object.defineProperty(HTMLElement.prototype, "scrollTop", {
      configurable: true,
      get() { return (this as HTMLElement & { _scrollTop?: number })._scrollTop ?? 0; },
      set(value: number) { (this as HTMLElement & { _scrollTop?: number })._scrollTop = value; },
    });

    const container = render(React.createElement(AgentTranscript, { projection, loading: false }));
    const transcript = container.querySelector(".desktop-agent-transcript") as HTMLElement;
    act(() => {
      transcript.scrollTop = 0;
      transcript.dispatchEvent(new Event("scroll"));
    });
    const jump = container.querySelector(".desktop-agent-jump-latest") as HTMLButtonElement;
    expect(jump.textContent).toBe("");
    expect(jump.getAttribute("aria-label")).toContain("Jump to latest");
    expect(jump.querySelector("svg")).not.toBeNull();
  });
});
