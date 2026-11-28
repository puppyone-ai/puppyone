/**
 * @vitest-environment happy-dom
 */
import React, { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentSessionBoundary } from "../../../../src/shared-ui/editor/document-session/DocumentSessionBoundary";
import { useEditableDocumentSource } from "../../../../src/shared-ui/editor/document-session/EditableDocumentSourceContext";
import { AUTO_SAVE_IDLE_MS } from "../../../../src/shared-ui/editor/document-session/autoSavePolicy";
import { closeAllDocumentWorkingCopies } from "../../../../src/shared-ui/editor/document-session/documentWorkingCopies";
import type { DocumentSessionStatus } from "../../../../src/shared-ui/editor/document-session/types";
import { SLOW_SAVE_INDICATOR_MS, useVisibleSaveStatus } from "../../../../src/shared-ui/editor/document-session/useVisibleSaveStatus";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  act(() => root?.unmount()); root = null;
  vi.useRealTimers();
  await closeAllDocumentWorkingCopies("app-close").catch(() => undefined);
  document.body.innerHTML = "";
});
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

function StatusProbe({ status, quiet }: { status: DocumentSessionStatus; quiet?: boolean }) {
  return <output>{useVisibleSaveStatus(status, quiet)}</output>;
}

describe("visible save status", () => {
  const show = (status: DocumentSessionStatus, quiet?: boolean) => act(() => root!.render(<StatusProbe status={status} quiet={quiet} />));

  it("keeps a quick background save silent: unsaved until it lands, then clean", async () => {
    show("dirty");
    expect(host.textContent).toBe("dirty");
    show("saving");
    await advance(SLOW_SAVE_INDICATOR_MS - 1);
    expect(host.textContent).toBe("dirty");
    show("saved");
    expect(host.textContent).toBe("clean");
    show("clean");
    expect(host.textContent).toBe("clean");
  });

  it("announces a slow save, then confirms it", async () => {
    show("saving");
    await advance(SLOW_SAVE_INDICATOR_MS);
    expect(host.textContent).toBe("saving");
    show("saved");
    expect(host.textContent).toBe("saved");
    show("clean");
    expect(host.textContent).toBe("clean");
    show("saving");
    expect(host.textContent).toBe("dirty");
  });

  it("never hides an error, and reports explicit saves at once", async () => {
    show("error");
    expect(host.textContent).toBe("error");
    show("saving", false);
    expect(host.textContent).toBe("saving");
    show("saved", false);
    expect(host.textContent).toBe("saved");
  });
});

function TypingProbe({ onReady }: { onReady: (type: (text: string) => void) => void }) {
  const source = useEditableDocumentSource();
  useLayoutEffect(() => {
    if (!source) return undefined;
    let snapshot = { revision: "r0", content: "base" };
    let revision = 0;
    const detach = source.attachSource({
      readSnapshot: () => snapshot,
      replaceContent: (content) => { snapshot = { revision: `x${revision}`, content }; return snapshot; },
    });
    source.reportRevision({ revision: snapshot.revision, origin: "model-initialization" });
    onReady((text) => {
      revision += 1;
      snapshot = { revision: `r${revision}`, content: text };
      source.reportRevision({ revision: snapshot.revision, origin: "local-edit" });
    });
    return detach;
  }, [onReady, source]);
  return null;
}

describe("save chip during Cloud editing", () => {
  function renderEditor(persist: () => Promise<{ ok: true; version: string }>, saveMode: "auto" | "manual" = "auto") {
    let type!: (text: string) => void;
    act(() => root!.render(withTestLocalization(
      <DocumentSessionBoundary documentId={`chip-${saveMode}.md`} initialContent="base" initialVersion="v1" saveMode={saveMode}
        persistence={{ kind: "cloud", storageIdentity: `test:quiet-chip:${saveMode}:${Math.random()}`, persist }} showSaveStatus>
        <TypingProbe onReady={(next) => { type = next; }} />
      </DocumentSessionBoundary>,
    )));
    return { type: (text: string) => act(() => type(text)) };
  }
  const chip = () => host.querySelector(".editor-save-overlay")?.textContent ?? "";

  it("shows nothing for a save that lands quickly", async () => {
    const editor = renderEditor(vi.fn(async () => ({ ok: true as const, version: "v2" })));
    editor.type("typed");
    expect(chip()).toBe("");
    await advance(AUTO_SAVE_IDLE_MS);
    await advance(0);
    expect(chip()).toBe("");
    await advance(SLOW_SAVE_INDICATOR_MS * 2);
    expect(chip()).toBe("");
  });

  it("says saving only once a save is slow, then confirms it", async () => {
    let finish!: () => void;
    const editor = renderEditor(vi.fn(() => new Promise<{ ok: true; version: string }>((resolve) => { finish = () => resolve({ ok: true, version: "v2" }); })));
    editor.type("typed on a slow network");
    await advance(AUTO_SAVE_IDLE_MS);
    expect(chip()).toBe("");
    await advance(SLOW_SAVE_INDICATOR_MS);
    expect(chip()).toMatch(/Saving/);
    await act(async () => { finish(); await vi.advanceTimersByTimeAsync(0); });
    expect(chip()).toMatch(/Saved/);
  });

  it("reports an explicit save immediately in manual mode", async () => {
    let finish!: () => void;
    const editor = renderEditor(vi.fn(() => new Promise<{ ok: true; version: string }>((resolve) => { finish = () => resolve({ ok: true, version: "v2" }); })), "manual");
    editor.type("manual draft");
    expect(chip()).toMatch(/Save/);
    const editorHost = host.querySelector(".editor-document-session-boundary")!;
    act(() => { editorHost.dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true })); });
    await advance(0);
    expect(chip()).toMatch(/Saving/);
    await act(async () => { finish(); await vi.advanceTimersByTimeAsync(0); });
    expect(chip()).toMatch(/Saved/);
  });
});
