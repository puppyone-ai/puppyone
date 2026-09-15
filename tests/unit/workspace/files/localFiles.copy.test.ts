import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalDataPort } from "../../../../src/lib/localFiles";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local workspace copy bridge", () => {
  it("forwards normalized DataPort paths to the authorized desktop workspace bridge", async () => {
    const copyEntry = vi.fn(async () => ({ path: "docs/note copy.md" }));
    vi.stubGlobal("window", {
      puppyoneDesktop: { copyEntry },
    });

    const dataPort = createLocalDataPort("/workspace");
    await expect(dataPort.copyNode?.("note.md", "docs", {
      forceDuplicateName: true,
    })).resolves.toEqual({ path: "docs/note copy.md" });

    expect(copyEntry).toHaveBeenCalledOnce();
    expect(copyEntry).toHaveBeenCalledWith({
      rootPath: "/workspace",
      fromPath: "note.md",
      targetFolderPath: "docs",
      forceDuplicateName: true,
    });
  });
});
