import { describe, expect, it } from "vitest";
import {
  isTerminalAgentVisible,
  setTerminalAgentVisible,
} from "../../../../../src/features/local-agents";

describe("Local Agent selection", () => {
  it("shows detected Agents in Terminal by default and persists only hidden launchers", () => {
    const defaults = { hiddenTerminalAgentIds: [], chatHistoryDiscoveryEnabled: false };
    expect(isTerminalAgentVisible(defaults, "codex")).toBe(true);

    const hidden = setTerminalAgentVisible(defaults, "codex", false);
    expect(hidden).toEqual({ hiddenTerminalAgentIds: ["codex"], chatHistoryDiscoveryEnabled: false });
    expect(isTerminalAgentVisible(hidden, "codex")).toBe(false);
    expect(setTerminalAgentVisible(hidden, "codex", true)).toEqual({
      hiddenTerminalAgentIds: [],
      chatHistoryDiscoveryEnabled: false,
    });
  });

  it("keeps hidden launcher ids stable and sorted", () => {
    const first = setTerminalAgentVisible({
      hiddenTerminalAgentIds: [],
      chatHistoryDiscoveryEnabled: true,
    }, "opencode", false);
    const second = setTerminalAgentVisible(first, "claude", false);
    expect(second).toEqual({
      hiddenTerminalAgentIds: ["claude", "opencode"],
      chatHistoryDiscoveryEnabled: true,
    });
  });
});
