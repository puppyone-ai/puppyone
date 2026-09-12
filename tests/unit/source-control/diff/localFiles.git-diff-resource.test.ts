import { afterEach, describe, expect, it, vi } from "vitest";
import { readWorkspaceGitDiffResource } from "../../../../src/lib/localFiles";

const MIB = 1024 * 1024;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("renderer Git diff resource reader", () => {
  it("assembles a bounded resource from identity-checked 4 MiB chunks", async () => {
    const size = 4 * MIB + 3;
    const readGitDiffResource = vi.fn(async (request: {
      offset: number;
      length: number;
      selectionIdentity: string;
      revisionIdentity: string;
    }) => ({
      bytes: new Uint8Array(request.length).fill(request.offset === 0 ? 1 : 2),
      offset: request.offset,
      size,
      done: request.offset + request.length === size,
      selectionIdentity: request.selectionIdentity,
      revisionIdentity: request.revisionIdentity,
    }));
    vi.stubGlobal("window", { puppyoneDesktop: { readGitDiffResource } });

    const result = new Uint8Array(await readWorkspaceGitDiffResource(resourceRequest(size)));
    expect(readGitDiffResource).toHaveBeenCalledTimes(2);
    expect(readGitDiffResource.mock.calls.map(([request]) => [request.offset, request.length])).toEqual([
      [0, 4 * MIB],
      [4 * MIB, 3],
    ]);
    expect(result.byteLength).toBe(size);
    expect(result[0]).toBe(1);
    expect(result.at(-1)).toBe(2);
  });

  it("fails closed on a mismatched range response", async () => {
    const readGitDiffResource = vi.fn(async (request) => ({
      bytes: new Uint8Array(request.length),
      offset: request.offset + 1,
      size: request.length,
      done: true,
      selectionIdentity: request.selectionIdentity,
      revisionIdentity: request.revisionIdentity,
    }));
    vi.stubGlobal("window", { puppyoneDesktop: { readGitDiffResource } });

    await expect(readWorkspaceGitDiffResource(resourceRequest(4)))
      .rejects.toThrow(/identity or range changed/i);
  });

  it("observes cancellation at chunk boundaries and skips IPC when already aborted", async () => {
    const controller = new AbortController();
    const readGitDiffResource = vi.fn(async (request) => {
      controller.abort();
      return {
        bytes: new Uint8Array(request.length),
        offset: request.offset,
        size: 4 * MIB + 1,
        done: false,
        selectionIdentity: request.selectionIdentity,
        revisionIdentity: request.revisionIdentity,
      };
    });
    vi.stubGlobal("window", { puppyoneDesktop: { readGitDiffResource } });

    await expect(readWorkspaceGitDiffResource(resourceRequest(4 * MIB + 1), controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(readGitDiffResource).toHaveBeenCalledOnce();

    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await expect(readWorkspaceGitDiffResource(resourceRequest(1), alreadyAborted.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(readGitDiffResource).toHaveBeenCalledOnce();
  });
});

function resourceRequest(size: number) {
  return {
    handle: "resource-handle",
    size,
    sessionId: "git-diff-session:test",
    selectionIdentity: "selection:1",
    revisionIdentity: "revision:1",
  };
}
