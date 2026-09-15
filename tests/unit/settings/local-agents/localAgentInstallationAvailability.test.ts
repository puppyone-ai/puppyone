import { describe, expect, it } from "vitest";
import {
  normalizeLocalAgentInstallationProgress,
  normalizeLocalAgentInstallationSnapshot,
} from "../../../../src/features/local-agents/model/localAgentInstallationAvailability";

describe("Local Agent installation availability", () => {
  it("restores stable registry order while preserving per-product outcomes", () => {
    const normalized = normalizeLocalAgentInstallationSnapshot(snapshot({
      availableAgentIds: ["hermes", "codex"],
      results: [found("hermes"), found("codex")],
    }));
    expect(normalized.availableAgentIds).toEqual(["codex", "hermes"]);
    expect(normalized.results.map(({ agentId }) => agentId)).toEqual(["codex", "hermes"]);
  });

  it("rejects unknown ids, malformed timestamps, and inconsistent availability", () => {
    expect(() => normalizeLocalAgentInstallationSnapshot(snapshot({
      completedAt: "not-a-date",
    }))).toThrow(/snapshot/i);
    expect(() => normalizeLocalAgentInstallationSnapshot(snapshot({
      availableAgentIds: ["unknown-agent"],
    }))).toThrow(/ids/i);
    expect(() => normalizeLocalAgentInstallationSnapshot(snapshot({
      availableAgentIds: ["codex"],
      results: [],
    }))).toThrow(/availability/i);
  });

  it("normalizes path-free progress and rejects impossible counts", () => {
    expect(normalizeLocalAgentInstallationProgress({
      availableAgentIds: ["hermes", "codex"],
      completedAgentCount: 2,
      generation: 1,
      requestId: "local-agent-installation:42",
      results: [found("hermes"), found("codex")],
      scanId: "local-agent-scan:1",
      totalAgentCount: 6,
    })).toMatchObject({
      availableAgentIds: ["codex", "hermes"],
      completedAgentCount: 2,
    });
    expect(() => normalizeLocalAgentInstallationProgress({
      availableAgentIds: [],
      completedAgentCount: 7,
      generation: 1,
      requestId: "local-agent-installation:42",
      results: [],
      scanId: "local-agent-scan:1",
      totalAgentCount: 6,
    })).toThrow(/progress/i);
  });
});

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    generation: 1,
    scanId: "local-agent-scan:1",
    requestedAt: "2026-08-15T00:00:00.000Z",
    completedAt: "2026-08-15T00:00:00.001Z",
    source: "scan",
    availableAgentIds: [],
    results: [],
    ...overrides,
  };
}

function found(agentId: string) {
  return { agentId, displayName: agentId, status: "found", source: "path-installation" };
}
