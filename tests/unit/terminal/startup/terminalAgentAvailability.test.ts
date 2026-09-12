import { describe, expect, it } from "vitest";
import {
  normalizeTerminalAgentLocationProgressEvent,
  normalizeTerminalAgentLocationSnapshot,
} from "../../../../src/features/desktop-terminal/model/terminalAgentAvailability";

describe("Terminal Agent availability", () => {
  it("accepts only allowlisted Agent ids and restores stable launcher order", () => {
    expect(normalizeTerminalAgentLocationSnapshot({
      availableAgentIds: ["hermes", "opencode", "unknown-agent", "pi", "cursor", "codex", "codex"],
      scannedAt: "2026-08-15T00:00:00.000Z",
      source: "scan",
    })).toEqual({
      availableAgentIds: ["codex", "cursor", "opencode", "pi", "hermes"],
      scannedAt: "2026-08-15T00:00:00.000Z",
      source: "scan",
    });
  });

  it("rejects malformed native snapshots", () => {
    expect(() => normalizeTerminalAgentLocationSnapshot({
      availableAgentIds: ["codex"],
      scannedAt: "not-a-date",
      source: "scan",
    })).toThrow(/timestamp/i);
    expect(() => normalizeTerminalAgentLocationSnapshot({
      availableAgentIds: "codex",
      scannedAt: "2026-08-15T00:00:00.000Z",
      source: "scan",
    })).toThrow(/availability/i);
  });

  it("normalizes path-free incremental events and rejects impossible counts", () => {
    expect(normalizeTerminalAgentLocationProgressEvent({
      availableAgentIds: ["hermes", "unknown-agent", "codex"],
      completedAgentCount: 3,
      requestId: "terminal-agent-location:42",
      totalAgentCount: 6,
    })).toEqual({
      availableAgentIds: ["codex", "hermes"],
      completedAgentCount: 3,
      requestId: "terminal-agent-location:42",
      totalAgentCount: 6,
    });
    expect(() => normalizeTerminalAgentLocationProgressEvent({
      availableAgentIds: [],
      completedAgentCount: 7,
      requestId: "terminal-agent-location:42",
      totalAgentCount: 6,
    })).toThrow(/counts/i);
  });
});
