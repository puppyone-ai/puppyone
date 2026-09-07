/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentSessionBoundary } from "../packages/shared-ui/src/editor/document-session/DocumentSessionBoundary";
import { TextEditorFrame } from "../packages/shared-ui/src/editor/viewers/shared/TextEditorFrame";
import { withTestLocalization } from "./testLocalization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let persistenceIdentity = 0;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("editable document external changes", () => {
  it("reloads an external file version when the editor is clean", async () => {
    const persistence = createPersistence();
    const harness = createHarness(persistence);

    await act(async () => harness.render("one", "v1"));
    await act(async () => harness.render("agent update", "v2"));

    expect(harness.value()).toBe("agent update");
    expect(persistence.persist).not.toHaveBeenCalled();
  });

  it("adopts an Agent version after the complete Viewer tree remounts without writing it back", async () => {
    const persistence = createPersistence();
    const harness = createHarness(persistence, "auto");

    await act(async () => harness.render("one", "v1"));
    await act(async () => harness.hide());
    await act(async () => harness.render("agent update while hidden", "v2"));
    await act(async () => Promise.resolve());

    expect(harness.value()).toBe("agent update while hidden");
    expect(harness.container.querySelector(".editor-inline-error")).toBeNull();
    expect(persistence.persist).not.toHaveBeenCalled();
  });

  it("replaces unsaved local input with disk content without a conflict prompt", async () => {
    const persistence = createPersistence();
    const harness = createHarness(persistence);
    await act(async () => harness.render("one", "v1"));
    act(() => harness.change("human update"));
    await act(async () => harness.render("agent update", "v2"));
    expect(harness.value()).toBe("agent update");
    expect(harness.container.querySelector(".editor-inline-error")).toBeNull();
    expect(persistence.persist).not.toHaveBeenCalled();
  });

  it("saves subsequent typing against the latest disk baseline", async () => {
    const persistence = createPersistence();
    const harness = createHarness(persistence);
    await act(async () => harness.render("one", "v1"));
    act(() => harness.change("discarded human update"));
    await act(async () => harness.render("agent update", "v2"));
    act(() => harness.change("agent update plus new typing"));
    await act(async () => harness.save());
    expect(persistence.persist).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      content: "agent update plus new typing", baseVersion: "v2", reason: "manual",
    }));
    expect(harness.value()).toBe("agent update plus new typing");
  });

  it("does not show an external-conflict banner for its own in-flight save echo", async () => {
    const first = deferred<{ ok: true; version: string }>();
    const second = deferred<{ ok: true; version: string }>();
    const persistence = {
      kind: "local-fs" as const,
      storageIdentity: "test:editable-external:queued",
      persist: vi.fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise),
    };
    const harness = createHarness(persistence, "auto");

    await act(async () => harness.render("one", "v1"));
    act(() => harness.change("two"));
    await act(async () => Promise.resolve());
    act(() => harness.change("three"));
    await act(async () => Promise.resolve());

    await act(async () => harness.render("two", "v2"));
    expect(harness.value()).toBe("three");
    expect(harness.container.querySelector(".editor-inline-error")).toBeNull();

    await act(async () => {
      first.resolve({ ok: true, version: "v2" });
      await Promise.resolve();
    });
    expect(persistence.persist).toHaveBeenLastCalledWith(expect.objectContaining({
      content: "three",
      baseVersion: "v2",
    }));

    await act(async () => {
      second.resolve({ ok: true, version: "v3" });
      await Promise.resolve();
    });
    expect(harness.container.querySelector(".editor-inline-error")).toBeNull();
  });
});

function createPersistence() {
  return {
    kind: "local-fs" as const,
    storageIdentity: `test:editable-external:${++persistenceIdentity}`,
    persist: vi.fn(async () => ({ ok: true as const, version: "saved-version" })),
  };
}

function createHarness(
  persistence: ReturnType<typeof createPersistence>,
  saveMode: "auto" | "manual" = "manual",
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  let change = (_content: string) => undefined;

  return {
    container,
    render(content: string, version: string) {
      root?.render(withTestLocalization(
        <DocumentSessionBoundary
          documentId="notes.txt"
          initialContent={content}
          initialVersion={version}
          saveMode={saveMode}
          persistence={persistence}
        >
          <TextEditorFrame
            documentId="notes.txt"
            documentVersion={version}
            content={content}
            nodeName="notes.txt"
            defaultMode="live"
            canEdit
            hideSourceView
            renderLive={(value, controls) => {
              change = controls.onChange;
              return <output data-editor-value={value}>{value}</output>;
            }}
          />
        </DocumentSessionBoundary>,
      ));
    },
    hide() {
      root?.render(null);
    },
    change(content: string) {
      change(content);
    },
    value() {
      return container.querySelector("[data-editor-value]")?.getAttribute("data-editor-value");
    },
    save() {
      container.querySelector(".editor-document-session-boundary")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }),
      );
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
