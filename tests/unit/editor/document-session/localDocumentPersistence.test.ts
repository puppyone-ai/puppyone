import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalDataPort } from "../../../../src/lib/localFiles";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local document persistence adapter", () => {
  it("forwards the session base version to authorized conditional-write IPC", async () => {
    const writeFile = vi.fn(async () => ({ ok: true as const, version: "sha256:new" }));
    vi.stubGlobal("window", {
      puppyoneDesktop: { writeFile },
    });

    const persistence = createLocalDataPort("/workspace").documentPersistence;
    expect(persistence).toMatchObject({
      kind: "local-fs",
      storageIdentity: "local-fs:/workspace",
    });

    await expect(persistence?.persist({
      path: "notes/today.md",
      content: "updated",
      revision: "editor:r2",
      baseVersion: "sha256:old",
      reason: "edit",
    })).resolves.toEqual({ ok: true, version: "sha256:new" });

    expect(writeFile).toHaveBeenCalledWith({
      rootPath: "/workspace",
      path: "notes/today.md",
      content: "updated",
      expectedVersion: "sha256:old",
    });
  });

  it.each([
    {
      ok: false as const,
      kind: "conflict" as const,
      content: "agent version",
      version: "sha256:agent",
    },
    {
      ok: false as const,
      kind: "not-found" as const,
      message: "The file was removed",
    },
    {
      ok: false as const,
      kind: "permission-denied" as const,
      message: "The file is read-only",
    },
    {
      ok: false as const,
      kind: "io" as const,
      message: "The disk is unavailable",
    },
  ])("preserves the structured $kind outcome across the renderer adapter", async (result) => {
    const writeFile = vi.fn(async () => result);
    vi.stubGlobal("window", {
      puppyoneDesktop: { writeFile },
    });
    const persistence = createLocalDataPort("/workspace").documentPersistence;

    await expect(persistence?.persist({
      path: "notes/today.md",
      content: "human version",
      revision: "editor:r2",
      baseVersion: "sha256:old",
      reason: "manual",
    })).resolves.toEqual(result);
  });
});
