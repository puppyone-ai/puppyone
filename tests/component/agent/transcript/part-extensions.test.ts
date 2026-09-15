/** @vitest-environment happy-dom */

import React from "react";

import { act } from "react";
import { describe, expect, it } from "vitest";

import { AgentTranscript } from "../../../../src/features/desktop-agent/ui/AgentTranscript";

import { registerAgentPartRenderer } from "../../../../src/features/desktop-agent/ui/AgentPartRenderer";

import { createAgentProjection } from "../../../support/agent/agentDisplayFixture";

import { withTestLocalization } from "../../../support/react/localization";
import { root, render } from "../../../support/agent/rendererHarness";

describe("Desktop Agent renderer surfaces", () => {

  it("registers semantic part extensions by kind and restores the previous renderer on dispose", () => {
    const projection = createAgentProjection();
    projection.parts = [{
      id: "future-part",
      turnId: "turn-1",
      itemId: "future-item",
      kind: "unknown",
      eventType: "future.semantic.part",
      label: "Future semantic part",
      sequence: 1,
    }];
    projection.rows = [{
      id: "row:future-part",
      partId: "future-part",
      turnId: "turn-1",
      kind: "unknown",
      sequence: 1,
      estimatedHeight: 36,
    }];
    const dispose = registerAgentPartRenderer("unknown", ({ part }) => React.createElement(
      "output",
      { "data-testid": "semantic-extension" },
      part.eventType,
    ));

    try {
      const container = render(React.createElement(AgentTranscript, { projection, loading: false }));
      expect(container.querySelector("[data-testid='semantic-extension']")?.textContent).toBe("future.semantic.part");

      dispose();
      act(() => root?.render(withTestLocalization(React.createElement(AgentTranscript, {
        projection: { ...projection, parts: projection.parts.map((part) => ({ ...part })) },
        loading: false,
      }))));
      expect(container.querySelector("[data-testid='semantic-extension']")).toBeNull();
      expect(container.textContent).toContain("Future semantic part");
    } finally {
      dispose();
    }
  });
});
