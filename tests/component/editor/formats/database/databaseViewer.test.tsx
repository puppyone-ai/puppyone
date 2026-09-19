/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilePreview } from "../../../../../packages/shared-ui/src/editor/host/FilePreview";
import type { DatabaseObject, DatabasePage, DatabasePreviewSession, EditorPreviewServices } from "../../../../../packages/shared-ui/src/editor/preview-services/types";
import { retireEditorHostLeases } from "../../../../../packages/shared-ui/src/editor/runtime/EditorHostLeases";
import { withTestLocalization } from "../../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement;
beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { act(() => root.unmount()); await retireEditorHostLeases(); document.body.innerHTML = ""; vi.useRealTimers(); });
function session(label: string, objects: readonly DatabaseObject[] = [{ id: "0", name: "items", kind: "table", readable: true }], engine: "sqlite" | "duckdb" = "sqlite"): DatabasePreviewSession {
  const expiresAt = Date.now() + 60_000;
  const columns = [{ id: "0", name: "label", type: "TEXT", primaryKey: false }];
  return { ready: Promise.resolve({ engine, engineVersion: "test", snapshotEpoch: label, expiresAt, pageRows: 50, pageColumns: 24,
    adapterVersion: 1, binding: "test", dataModel: "relational", consistency: "read-transaction",
    capabilities: { metadata: true, browse: true, filter: false, sort: false, count: false, sql: false },
    objects }),
    close: vi.fn(async () => undefined),
    readPage: vi.fn(async () => ({ snapshotEpoch: label, expiresAt, columns, visibleColumns: columns,
      rows: [[{ kind: "text", text: label, truncated: false }]], cursor: "next", hasMore: true })),
  };
}
async function render(services: EditorPreviewServices, path = "sample.db", workspaceId = "project-A", inputGeneration = 0) {
  await act(async () => root.render(withTestLocalization(<FilePreview
    node={{ id: path, path, name: path, type: "file" }} workspaceId={workspaceId}
    previewServices={services} inputGeneration={inputGeneration} />)));
}
async function ready() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (container.querySelector(".database-preview td")) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  }
  throw new Error(container.textContent ?? "Database viewer did not mount");
}

async function timed(open: NonNullable<EditorPreviewServices["database"]>["open"]) {
  // Resolve the lazy viewer before installing virtual time, even for -t runs.
  await render({ database: { open: async () => session("warmup") } }); await ready();
  vi.useFakeTimers();
  await render({ database: { open } }, "timed.db");
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(container.querySelector("td")).not.toBeNull();
}
async function click(label: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button).not.toBeNull();
  await act(async () => button!.click());
}

describe("registered database DOM viewer", () => {
  it("routes through FilePreview, displays database text inertly and pages without a working copy", async () => {
    const value = session('<script>alert("database")</script>');
    await render({ database: { open: async () => value } }); await ready();
    expect(container.querySelector(".database-preview")).not.toBeNull();
    expect(container.querySelector("td")?.textContent).toContain("<script>");
    expect(container.querySelector("script, iframe, canvas, [contenteditable=true]")).toBeNull();
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("items");
    expect(container.textContent).not.toContain("Read-only");
    expect(container.textContent).not.toContain("total unknown");
    const next = container.querySelector<HTMLButtonElement>('button[aria-label="Next page"]')!;
    await act(async () => next.click());
    expect(value.readPage).toHaveBeenLastCalledWith({ cursor: "next" }, expect.any(AbortSignal));
  });

  it("keeps unavailable objects discoverable while supported DuckDB views remain operable", async () => {
    const value = session("view row", [
      { id: "0", name: "main.items", kind: "BASE TABLE", readable: true },
      { id: "1", name: "audit.safe_view", kind: "VIEW", readable: true },
      { id: "2", name: "sqlite_unsafe", kind: "view", readable: false, unavailableReason: "unsupported-object-kind" },
    ], "duckdb");
    await render({ database: { open: async () => value } }); await ready();
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs).toHaveLength(3);
    expect(tabs[2].getAttribute("aria-disabled")).toBe("true");
    expect(tabs[2].hasAttribute("disabled")).toBe(false);
    expect(tabs[2].title).toContain("cannot be previewed");
    tabs[0].focus();
    await act(async () => tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(document.activeElement).toBe(tabs[1]);
    const readPage = vi.mocked(value.readPage);
    const calls = readPage.mock.calls.length;
    await act(async () => tabs[2].click());
    expect(readPage).toHaveBeenCalledTimes(calls);
    await act(async () => tabs[1].click());
    expect(readPage).toHaveBeenLastCalledWith({ objectId: "1", columnOffset: 0 }, expect.any(AbortSignal));
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
  });

  it("drops late opening results across A→B→A and releases every native lease", async () => {
    let finish!: (value: DatabasePreviewSession) => void;
    const first = session("stale private row"), second = session("current row");
    const open = vi.fn().mockImplementationOnce(() => new Promise<DatabasePreviewSession>((resolve) => { finish = resolve; }))
      .mockResolvedValue(second);
    const services = { database: { open } };
    await render(services); await render(services, "other.db", "project-B"); await ready();
    expect(container.textContent).toContain("current row");
    await act(async () => finish(first));
    expect(first.close).toHaveBeenCalledTimes(1); expect(first.readPage).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("stale private row");
    await render(services, "sample.db", "project-A"); await ready();
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it("reopens on input generation change but not unrelated parent renders", async () => {
    const values = [session("before"), session("after")];
    const open = vi.fn().mockResolvedValueOnce(values[0]).mockResolvedValueOnce(values[1]); const services = { database: { open } };
    await render(services); await ready(); await render(services); expect(open).toHaveBeenCalledTimes(1);
    await render(services, "sample.db", "project-A", 1); await ready();
    expect(open).toHaveBeenCalledTimes(2); expect(values[0].close).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("after");
  });

  it("releases an idle native lease without clearing the page or repeatedly reopening while reading", async () => {
    const value = session("retained row"), open = vi.fn(async () => value);
    await timed(open);
    const cell = container.querySelector<HTMLTableCellElement>("td")!;
    cell.focus();
    await act(async () => { await vi.advanceTimersByTimeAsync(360_000); });
    expect(container.querySelector("td")).toBe(cell);
    expect(document.activeElement).toBe(cell);
    expect(cell.textContent).toBe("retained row");
    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(open).toHaveBeenCalledTimes(1);
    expect(value.close).toHaveBeenCalledTimes(1);
    await click("Schema");
    expect(container.querySelector(".database-preview__table--schema")).not.toBeNull();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("reconnects on next-page intent, remaps object IDs, and never replays an old cursor", async () => {
    const old = session("old page");
    let fresh!: DatabasePreviewSession;
    const open = vi.fn().mockResolvedValueOnce(old).mockImplementation(async () => {
      fresh = session("fresh page", [{ id: "new-id", name: "items", kind: "table", readable: true }]);
      return fresh;
    });
    await timed(open);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_001); });
    await click("Next page");
    expect(open).toHaveBeenCalledTimes(2);
    expect(fresh.readPage).toHaveBeenCalledExactlyOnceWith({ objectId: "new-id", columnOffset: 0 }, expect.any(AbortSignal));
    expect(container.querySelector("td")?.textContent).toBe("fresh page");
    expect(container.querySelector(".database-preview__range")?.textContent).toBe("1–1");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("back to first page");
    await click("Next page");
    expect(fresh.readPage).toHaveBeenLastCalledWith({ cursor: "next" }, expect.any(AbortSignal));
    expect(container.querySelector(".database-preview__range")?.textContent).toBe("2–2");
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("selects the requested table after idle recovery instead of defaulting to the first table", async () => {
    const objects = [{ id: "0", name: "items", kind: "table", readable: true }, { id: "1", name: "other", kind: "table", readable: true }];
    const old = session("old", objects);
    let fresh!: DatabasePreviewSession;
    const open = vi.fn().mockResolvedValueOnce(old).mockImplementation(async () => {
      fresh = session("other row", objects.map((object) => ({ ...object, id: `new-${object.id}` })));
      return fresh;
    });
    await timed(open);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_001); });
    await click("other");
    expect(fresh.readPage).toHaveBeenCalledExactlyOnceWith({ objectId: "new-1", columnOffset: 0 }, expect.any(AbortSignal));
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("other");
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("does not let the previous idle timer cancel a page query already in flight", async () => {
    const value = session("before"), open = vi.fn(async () => value);
    await timed(open);
    let finish!: (page: DatabasePage) => void;
    vi.mocked(value.readPage).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(59_000); });
    await click("Next page");
    await click("Next page"); // Busy UI must not issue a duplicate query.
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    const last = vi.mocked(value.readPage).mock.calls.at(-1)!;
    expect(last[1].aborted).toBe(false);
    expect(value.close).not.toHaveBeenCalled();
    expect(value.readPage).toHaveBeenCalledTimes(2);
    await act(async () => finish({ rows: [[{ kind: "text", text: "after", truncated: false }]],
      cursor: null, hasMore: false, snapshotEpoch: "before", expiresAt: Date.now() + 60_000 }));
    expect(container.querySelector("td")?.textContent).toBe("after");
    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("recovers once when the native session expires before the renderer timer", async () => {
    const old = session("before"), fresh = session("after");
    const open = vi.fn().mockResolvedValueOnce(old).mockResolvedValueOnce(fresh);
    await timed(open);
    vi.mocked(old.readPage).mockRejectedValueOnce(new Error("session-expired"));
    await click("Next page");
    expect(old.close).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(2);
    expect(fresh.readPage).toHaveBeenCalledExactlyOnceWith({ objectId: "0", columnOffset: 0 }, expect.any(AbortSignal));
    expect(container.querySelector("td")?.textContent).toBe("after");
  });

  it.each(["stale-input", "permission-denied", "recovery-required", "timeout", "invalid-request"])(
    "clears unsafe results and does not automatically retry %s",
    async (code) => {
      const value = session("private row"), open = vi.fn(async () => value);
      await timed(open);
      vi.mocked(value.readPage).mockRejectedValueOnce(new Error(code));
      await click("Next page");
      expect(container.querySelector("td")).toBeNull();
      expect(container.querySelector("[role=alert]")?.getAttribute("data-error-code")).toBe(code);
      expect(open).toHaveBeenCalledTimes(1);
      expect(value.close).toHaveBeenCalled();
    },
  );

  it("bounds automatic recovery when a replacement session also expires", async () => {
    const old = session("old"), fresh = session("fresh");
    const open = vi.fn().mockResolvedValueOnce(old).mockResolvedValue(fresh);
    await timed(open);
    vi.mocked(old.readPage).mockRejectedValue(new Error("session-expired"));
    vi.mocked(fresh.readPage).mockRejectedValue(new Error("session-expired"));
    await click("Next page");
    expect(open).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[role=alert]")?.getAttribute("data-error-code")).toBe("session-expired");
    expect(container.querySelector("[role=alert]")?.textContent).not.toContain("file has changed");
  });

  it("waits for confirmed exit before opening a replacement session", async () => {
    const old = session("old"), open = vi.fn(async () => old);
    await timed(open);
    vi.mocked(old.close).mockRejectedValue(new Error("exit-unconfirmed"));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_001); });
    expect(container.querySelector("td")?.textContent).toBe("old");
    await click("Next page");
    expect(open).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[role=alert]")?.getAttribute("data-error-code")).toBe("exit-unconfirmed");
    vi.mocked(old.close).mockResolvedValue(undefined);
  });

  it("discards delayed recovery results after switching workspace", async () => {
    const old = session("old");
    let finish!: (session: DatabasePreviewSession) => void;
    const open = vi.fn().mockResolvedValueOnce(old).mockImplementationOnce(() => new Promise<DatabasePreviewSession>((resolve) => { finish = resolve; }));
    await timed(open);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_001); });
    await click("Next page");
    await render({ database: { open: async () => session("current workspace") } }, "other.db", "project-B");
    const late = session("late private row");
    await act(async () => finish(late));
    expect(late.close).toHaveBeenCalledTimes(1);
    expect(late.readPage).not.toHaveBeenCalled();
    expect(container.textContent).toContain("current workspace");
    expect(container.textContent).not.toContain("late private row");
  });

  it("invalidates a retained page on real input-generation change even after the connection is asleep", async () => {
    const old = session("retained private row"), open = vi.fn().mockResolvedValueOnce(old)
      .mockRejectedValueOnce(new Error("permission-denied"));
    await timed(open);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_001); });
    expect(container.querySelector("td")?.textContent).toBe("retained private row");
    await render({ database: { open } }, "timed.db", "project-A", 1);
    expect(container.querySelector("td")).toBeNull();
    expect(container.querySelector("[role=alert]")?.getAttribute("data-error-code")).toBe("permission-denied");
    expect(open).toHaveBeenCalledTimes(2);
  });
});
