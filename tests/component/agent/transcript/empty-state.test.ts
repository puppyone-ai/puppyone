/** @vitest-environment happy-dom */

import React from "react";

import { act } from "react";
import { describe, expect, it } from "vitest";

import { AgentEmptyState } from "../../../../src/features/desktop-agent/ui/AgentEmptyState";

import { AgentTranscript } from "../../../../src/features/desktop-agent/ui/AgentTranscript";

import { createAgentProjection } from "../../../support/agent/agentDisplayFixture";

import { stripBidiIsolation, testT } from "../../../support/react/localization";
import { render } from "../../../support/agent/rendererHarness";

describe("Desktop Agent renderer surfaces", () => {

  it("keeps the transcript generic when no product empty-state slot is supplied", () => {
    const container = render(React.createElement(AgentTranscript, {
      projection: createAgentProjection(),
      loading: false,
      runtimeLabel: "Codex",
    }));

    expect(container.textContent).toBe("");
    expect(container.querySelector(".desktop-agent-empty")).toBeNull();
  });

  it("renders the quiet runtime identity only for a ready empty conversation", () => {
    const emptyState = React.createElement(AgentEmptyState, {
      runtimeIconKey: "codex",
      runtimeLabel: "Codex",
    });
    const container = render(React.createElement(AgentTranscript, {
      projection: createAgentProjection(),
      loading: false,
      runtimeLabel: "Codex",
      emptyState,
    }));

    expect(container.textContent).toContain(testT("agent.empty.prompt"));
    expect(container.querySelector(".desktop-agent-empty-state .desktop-agent-brand-mark.is-codex.is-monochrome")).not.toBeNull();
    expect(container.querySelector(".desktop-agent-empty-state .po-agent-monochrome-brand-image")).not.toBeNull();
    expect(container.querySelector(".desktop-agent-empty-state .po-agent-brand-image")).toBeNull();

    const logoButton = container.querySelector<HTMLButtonElement>(".desktop-agent-empty-logo-button");
    expect(stripBidiIsolation(logoButton?.getAttribute("aria-label"))).toBe("Spin the Codex logo");
    expect(logoButton?.style.getPropertyValue("--agent-empty-logo-turns")).toBe("0");
    act(() => {
      logoButton?.click();
      logoButton?.click();
      logoButton?.click();
    });
    expect(logoButton?.style.getPropertyValue("--agent-empty-logo-turns")).toBe("3");
  });

  it("uses Pi's theme-colored normalized vector in the empty conversation", () => {
    const container = render(React.createElement(AgentTranscript, {
      projection: createAgentProjection(),
      loading: false,
      runtimeLabel: "Pi Agent",
      emptyState: React.createElement(AgentEmptyState, {
        runtimeIconKey: "pi",
        runtimeLabel: "Pi Agent",
      }),
    }));

    const brandMark = container.querySelector(
      ".desktop-agent-empty-state .desktop-agent-brand-mark.is-pi.is-monochrome",
    );
    expect(brandMark?.querySelector('.po-agent-monochrome-brand-image[fill="currentColor"]')).not.toBeNull();
    expect(brandMark?.querySelector(".po-agent-brand-image")).toBeNull();
  });

  it("removes the empty-state cue as soon as a prompt enters the live tail", () => {
    const container = render(React.createElement(AgentTranscript, {
      projection: createAgentProjection(),
      loading: false,
      pendingPrompt: "Start here",
      runtimeLabel: "Codex",
      emptyState: React.createElement(AgentEmptyState, {
        runtimeIconKey: "codex",
        runtimeLabel: "Codex",
      }),
    }));

    expect(container.querySelector(".desktop-agent-empty-state")).toBeNull();
    expect(container.textContent).toContain("Start here");
  });
});
