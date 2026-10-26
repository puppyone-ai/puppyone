import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentPanelStatus } from "../../../../src/features/desktop-agent/ui/AgentPanelStatus";
import { stripBidiIsolation, withTestLocalization } from "../../../support/react/localization";

describe("Agent failure presentation", () => {
  it.each([false, true])("distinguishes preparation failure from confirmed exit (%s)", runtimeExited => {
    const html = stripBidiIsolation(renderToStaticMarkup(withTestLocalization(<AgentPanelStatus
      failed unavailable={false} runtimeExited={runtimeExited} runtimeLabel="Codex"
      error={{ code: runtimeExited ? "session-ended" : "session-prepare-failed" }} onRetry={() => {}}
    />)));
    expect(html).toContain(runtimeExited ? "Codex disconnected" : "Codex needs attention");
    if (!runtimeExited) expect(html).not.toContain("disconnected");
    expect(html).toContain(runtimeExited ? "Reconnect" : "Retry");
  });
});
