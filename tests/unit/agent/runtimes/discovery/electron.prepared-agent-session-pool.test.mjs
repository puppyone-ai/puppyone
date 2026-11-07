import { afterEach, describe, expect, it, vi } from "vitest";
import { PreparedAgentSessionPool } from "../../../../../electron/main/agent/application/runtime-resolution/prepared-agent-session-pool.mjs";

const readiness = { executablePath: "/tools/agent", argsPrefix: [], version: "1", environment: { HOME: "/user" } };
const adapter = () => ({ adoptPreparedSession: vi.fn(() => true), dispose: vi.fn(async () => {}) });

describe("prepared native sessions", () => {
  afterEach(() => vi.useRealTimers());

  it("transfers a session once, only for the same runtime and workspace", () => {
    const pool = new PreparedAgentSessionPool();
    const prepared = adapter(), callbacks = { onEvent: vi.fn() };
    pool.put("cursor", "/a", readiness, prepared);
    expect(pool.take("hermes", "/a", readiness, callbacks)).toBeNull();
    expect(pool.take("cursor", "/b", readiness, callbacks)).toBeNull();
    expect(pool.take("cursor", "/a", readiness, callbacks)).toBe(prepared);
    expect(prepared.adoptPreparedSession).toHaveBeenCalledWith(callbacks);
    expect(pool.take("cursor", "/a", readiness, callbacks)).toBeNull();
    expect(prepared.dispose).not.toHaveBeenCalled();
    pool.clear();
  });

  it.each([
    { ...readiness, version: "2" },
    { ...readiness, executablePath: "/other/agent" },
    { ...readiness, argsPrefix: ["other"] },
    { ...readiness, environment: { HOME: "/other" } },
  ])("discards a session when launch configuration changes", (changed) => {
    const pool = new PreparedAgentSessionPool(), prepared = adapter();
    pool.put("cursor", "/a", readiness, prepared);
    expect(pool.take("cursor", "/a", changed, {})).toBeNull();
    expect(prepared.dispose).toHaveBeenCalledOnce();
  });

  it("expires unused sessions, evicts excess entries, and clears all pending ownership", () => {
    vi.useFakeTimers();
    const pool = new PreparedAgentSessionPool({ ttlMs: 100, maxEntries: 2 });
    const first = adapter(), second = adapter(), third = adapter();
    pool.put("cursor", "/a", readiness, first);
    pool.put("cursor", "/b", readiness, second);
    pool.put("cursor", "/c", readiness, third);
    expect(first.dispose).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(100);
    expect(second.dispose).toHaveBeenCalledOnce();
    expect(third.dispose).toHaveBeenCalledOnce();
    expect(pool.take("cursor", "/c", readiness, {})).toBeNull();
    const last = adapter();
    pool.put("cursor", "/d", readiness, last);
    pool.clear();
    expect(last.dispose).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("discards a prepared connection that exited before adoption", () => {
    const pool = new PreparedAgentSessionPool(), prepared = adapter();
    prepared.adoptPreparedSession.mockReturnValue(false);
    pool.put("cursor", "/a", readiness, prepared);
    expect(pool.take("cursor", "/a", readiness, {})).toBeNull();
    expect(prepared.dispose).toHaveBeenCalledOnce();
  });
});
