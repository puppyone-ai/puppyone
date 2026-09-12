import { describe, expect, it, vi } from "vitest";
import { terminalAgentCatalogDefaults } from "../../../../electron/main/terminal-agent/terminal-agent-catalog.mjs";
import { createTerminalAgentLocator } from "../../../../electron/main/terminal-agent/terminal-agent-locator.mjs";
import { DESKTOP_TERMINAL_LAUNCHERS } from "../../../../src/features/desktop-terminal/model/terminalLaunchers.ts";

const catalog = Object.freeze([
  Object.freeze({ id: "codex", displayName: "Codex", executableNames: Object.freeze(["codex"]) }),
  Object.freeze({ id: "claude", displayName: "Claude Code", executableNames: Object.freeze(["claude"]) }),
  Object.freeze({ id: "cursor", displayName: "Cursor Agent", executableNames: Object.freeze(["cursor-agent"]) }),
  Object.freeze({ id: "opencode", displayName: "OpenCode", executableNames: Object.freeze(["opencode"]) }),
]);

describe("Terminal Agent lightweight locator", () => {
  it("keeps every supported product in the immutable default catalog", () => {
    expect(terminalAgentCatalogDefaults.map(({ id }) => id)).toEqual([
      "codex",
      "claude",
      "cursor",
      "opencode",
      "pi",
      "hermes",
    ]);
    expect(terminalAgentCatalogDefaults.find(({ id }) => id === "pi")?.executableNames)
      .toEqual(["pi"]);
    expect(terminalAgentCatalogDefaults.find(({ id }) => id === "hermes")?.executableNames)
      .toEqual(["hermes"]);
    expect(DESKTOP_TERMINAL_LAUNCHERS.filter(({ id }) => id !== "shell").map(({ id }) => id))
      .toEqual(terminalAgentCatalogDefaults.map(({ id }) => id));
  });

  it("returns only filesystem-resolvable products in stable catalog order", async () => {
    const resolveCandidate = vi.fn(async (definition) => (
      definition.id === "codex" || definition.id === "opencode"
        ? { executablePath: `/tools/${definition.id}` }
        : null
    ));
    const locator = createTerminalAgentLocator({ catalog, resolveCandidate });

    await expect(locator.locate()).resolves.toMatchObject({
      availableAgentIds: ["codex", "opencode"],
      source: "scan",
    });
    expect(resolveCandidate).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(await locator.locate())).not.toContain("/tools/");
  });

  it("uses its memory cache and makes explicit refresh authoritative", async () => {
    let now = 1_000;
    const resolveCandidate = vi.fn(async () => ({ executablePath: "/tools/agent" }));
    const locator = createTerminalAgentLocator({
      catalog,
      now: () => now,
      resolveCandidate,
    });

    expect((await locator.locate()).source).toBe("scan");
    expect(resolveCandidate).toHaveBeenCalledTimes(4);
    now += 1_000;
    expect((await locator.locate()).source).toBe("memory-cache");
    expect(resolveCandidate).toHaveBeenCalledTimes(4);
    expect((await locator.locate({ refresh: true })).source).toBe("scan");
    expect(resolveCandidate).toHaveBeenCalledTimes(8);
  });

  it("isolates one failed product probe without failing the selector", async () => {
    const locator = createTerminalAgentLocator({
      catalog,
      resolveCandidate: vi.fn(async (definition) => {
        if (definition.id === "claude") throw new Error("filesystem unavailable");
        return definition.id === "cursor" ? { executablePath: "/tools/cursor" } : null;
      }),
    });

    await expect(locator.locate()).resolves.toMatchObject({
      availableAgentIds: ["cursor"],
    });
  });

  it("scales to new catalog entries without product-specific locator code", async () => {
    const extensibleCatalog = Object.freeze([
      Object.freeze({ id: "pi", displayName: "Pi Agent", executableNames: Object.freeze(["pi"]) }),
      Object.freeze({ id: "hermes", displayName: "Hermes Agent", executableNames: Object.freeze(["hermes"]) }),
      Object.freeze({ id: "kimi", displayName: "Kimi Code", executableNames: Object.freeze(["kimi"]) }),
    ]);
    const resolveCandidate = vi.fn(async (definition) => (
      definition.id === "hermes" || definition.id === "kimi"
        ? { executablePath: `/tools/${definition.id}` }
        : null
    ));
    const locator = createTerminalAgentLocator({
      catalog: extensibleCatalog,
      resolveCandidate,
    });

    await expect(locator.locate()).resolves.toMatchObject({
      availableAgentIds: ["hermes", "kimi"],
    });
    expect(resolveCandidate).toHaveBeenCalledTimes(extensibleCatalog.length);
  });

  it("shares one bounded search context and publishes path-free incremental results", async () => {
    const context = Object.freeze({ executableSearch: Object.freeze({ directories: [] }) });
    const createResolutionContext = vi.fn(async () => context);
    const progress = vi.fn();
    const resolveCandidate = vi.fn(async (definition, receivedContext) => {
      expect(receivedContext).toBe(context);
      return definition.id === "claude" || definition.id === "opencode"
        ? { executablePath: `/tools/${definition.id}` }
        : null;
    });
    const locator = createTerminalAgentLocator({
      catalog,
      createResolutionContext,
      resolveCandidate,
    });

    await expect(locator.locate({ onProgress: progress })).resolves.toMatchObject({
      availableAgentIds: ["claude", "opencode"],
    });
    expect(createResolutionContext).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledTimes(catalog.length);
    expect(progress).toHaveBeenLastCalledWith({
      availableAgentIds: ["claude", "opencode"],
      completedAgentCount: catalog.length,
      totalAgentCount: catalog.length,
    });
    expect(JSON.stringify(progress.mock.calls)).not.toContain("/tools/");
  });

  it("keeps cache and cold-scan diagnostics local to the main process", async () => {
    const monotonicReadings = [100, 106.257];
    const locator = createTerminalAgentLocator({
      catalog,
      monotonicNow: () => monotonicReadings.shift() ?? 106.257,
      now: () => 1_000,
      resolveCandidate: vi.fn(async () => null),
    });

    await locator.locate();
    await locator.locate();
    expect(locator.getDiagnostics()).toEqual({
      cacheHitCount: 1,
      catalogSize: catalog.length,
      lastAvailableCount: 0,
      lastScanCompletedAt: "1970-01-01T00:00:01.000Z",
      lastScanDurationMs: 6.26,
      scanCount: 1,
    });
  });
});
