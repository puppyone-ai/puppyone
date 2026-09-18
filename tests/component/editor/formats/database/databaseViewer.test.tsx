/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilePreview } from "../../../../../packages/shared-ui/src/editor/host/FilePreview";
import type { DatabasePreviewSession, EditorPreviewServices } from "../../../../../packages/shared-ui/src/editor/preview-services/types";
import { retireEditorHostLeases } from "../../../../../packages/shared-ui/src/editor/runtime/EditorHostLeases";
import { withTestLocalization } from "../../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement;
beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { act(() => root.unmount()); await retireEditorHostLeases(); document.body.innerHTML = ""; vi.useRealTimers(); });
function session(label: string): DatabasePreviewSession {
  const expiresAt = Date.now() + 60_000;
  const columns = [{ id: "0", name: "label", type: "TEXT", primaryKey: false }];
  return { ready: Promise.resolve({ engine: "sqlite", engineVersion: "test", snapshotEpoch: label, expiresAt, pageRows: 50, pageColumns: 24,
    adapterVersion: 1, binding: "test", dataModel: "relational", consistency: "read-transaction",
    capabilities: { metadata: true, browse: true, filter: false, sort: false, count: false, sql: false },
    objects: [{ id: "0", name: "items", kind: "table", readable: true }] }),
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

describe("registered database DOM viewer", () => {
  it("routes through FilePreview, displays database text inertly and pages without a working copy", async () => {
    const value = session('<script>alert("database")</script>');
    await render({ database: { open: async () => value } }); await ready();
    expect(container.querySelector(".database-preview")).not.toBeNull();
    expect(container.querySelector("td")?.textContent).toContain("<script>");
    expect(container.querySelector("script, iframe, canvas, [contenteditable=true]")).toBeNull();
    expect(container.textContent).toContain("Read-only"); expect(container.textContent).toContain("total unknown");
    const next = [...container.querySelectorAll("button")].find((button) => button.textContent === "Next page")!;
    await act(async () => next.click());
    expect(value.readPage).toHaveBeenLastCalledWith({ cursor: "next" }, expect.any(AbortSignal));
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

  it("conceals stale data at lease expiry and explains safe failure", async () => {
    const value = session("private row");
    await render({ database: { open: async () => value } }); await ready();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // A fresh revision installs the expiry timer under the fake clock.
    const services = { database: { open: async () => value } };
    await render(services, "sample.db", "project-A", 1);
    await act(async () => vi.advanceTimersByTime(60_001));
    expect(container.querySelector("td")).toBeNull();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("snapshot expired");
    expect(value.close).toHaveBeenCalled();
  });
});
