/** @vitest-environment happy-dom */
import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataPort } from "../../../../../../src/shared-ui/core/types";
import { useWorkspaceReferenceTargets } from "../../../../../../src/shared-ui/data/useWorkspaceReferenceTargets";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.useRealTimers(); });

describe("reference metadata lifecycle", () => {
  it("discards superseded workspaces and refreshes, including late non-abortable responses", async () => {
    vi.useFakeTimers();
    const pending: Array<(targets: { name: string; path: string }[]) => void> = [];
    const ports: DataPort[] = [0, 1].map(() => ({
      listChildren: async () => [],
      listReferenceTargets: vi.fn<NonNullable<DataPort["listReferenceTargets"]>>(() => new Promise(resolve => pending.push(resolve))),
    }));
    const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    function Harness({ port, revision }: { port: DataPort; revision: number }) {
      const refresh = useMemo(() => ({ sequence: revision, entries: [] }), [revision]);
      return <div>{useWorkspaceReferenceTargets(port, refresh).map(target => target.path).join(",")}</div>;
    }
    const render = (port: DataPort, revision: number) => act(() => root?.render(<Harness port={port} revision={revision} />));
    const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(110); });
    render(ports[0], 0); await tick();
    await act(async () => pending.shift()!([{ name: "old.jpg", path: "old.jpg" }]));
    expect(container.textContent).toBe("old.jpg");
    render(ports[0], 1); expect(container.textContent).toBe("old.jpg"); await tick();
    render(ports[1], 0); expect(container.textContent).toBe(""); await tick();
    await act(async () => pending.shift()!([{ name: "stale.jpg", path: "stale.jpg" }]));
    expect(container.textContent).toBe("");
    await act(async () => pending.shift()!([{ name: "current.jpg", path: "current.jpg" }]));
    expect(container.textContent).toBe("current.jpg");
    expect(vi.mocked(ports[0].listReferenceTargets!).mock.calls[1][0]?.signal?.aborted).toBe(true);
  });
});
