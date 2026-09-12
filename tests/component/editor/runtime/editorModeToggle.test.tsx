/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  EditorPaneMenuContributionProvider,
  type EditorPaneMenuContribution,
  useEditorPaneMenuContributionPublisher,
} from "../../../../packages/shared-ui/src/editor/editorPaneMenuContribution";
import { TextEditorFrame } from "../../../../packages/shared-ui/src/editor/viewers/shared/TextEditorFrame";
import { testT, withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("editor mode toggle", () => {
  it("publishes the editor modes as a segmented pane-menu control", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    let contribution: EditorPaneMenuContribution | null = null;

    act(() => root?.render(withTestLocalization(
      <EditorPaneMenuContributionProvider
        onContributionChange={(nextContribution) => {
          contribution = nextContribution;
        }}
      >
        <TextEditorFrame
          documentId="mode.md"
          content="# Heading"
          nodeName="mode.md"
          defaultMode="live"
          canEdit
          hideSourceView={false}
          modeControlPlacement="pane-menu"
          renderLive={() => <output data-editor-mode="live" />}
          renderSource={() => <output data-editor-mode="source" />}
        />
      </EditorPaneMenuContributionProvider>,
    )));

    expect(container.querySelector('[data-editor-mode="live"]')).not.toBeNull();
    expect(container.querySelector('[data-editor-mode="source"]')).toBeNull();
    expect(container.querySelector(".editor-mode-toggle")).toBeNull();
    expect(contribution).toMatchObject({
      documentId: "mode.md",
      viewItems: [{
        kind: "segmented",
        id: "editor-view-mode",
        label: testT("editor.mode.label"),
        value: "live",
        options: [
          { id: "live", label: testT("editor.mode.live") },
          { id: "source", label: testT("editor.mode.source") },
        ],
      }],
    });

    const modeControl = contribution?.viewItems[0];
    expect(modeControl?.kind).toBe("segmented");
    act(() => {
      if (modeControl?.kind === "segmented") modeControl.setValue("source");
    });

    expect(container.querySelector('[data-editor-mode="live"]')).toBeNull();
    expect(container.querySelector('[data-editor-mode="source"]')).not.toBeNull();
    expect(contribution?.viewItems[0]).toMatchObject({ value: "source" });
  });

  it.each([
    ["Command", { metaKey: true }],
    ["Control", { ctrlKey: true }],
  ])("toggles preview/source mode with %s shortcut", (_modifierName, modifier) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(withTestLocalization(
      <TextEditorFrame
        documentId="mode-shortcut.md"
        content="# Heading"
        nodeName="mode-shortcut.md"
        defaultMode="live"
        canEdit
        hideSourceView={false}
        enableModeToggleShortcut
        renderLive={() => <button type="button" data-editor-mode="live">live</button>}
        renderSource={() => <button type="button" data-editor-mode="source">source</button>}
      />,
    )));

    const liveButton = container.querySelector<HTMLButtonElement>('[data-editor-mode="live"]');
    liveButton?.focus();

    expect(container.querySelector('[data-editor-mode="live"]')).not.toBeNull();
    expect(container.querySelector('[data-editor-mode="source"]')).toBeNull();

    act(() => {
      liveButton?.dispatchEvent(new KeyboardEvent("keydown", {
        key: "/",
        ...modifier,
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(container.querySelector('[data-editor-mode="live"]')).toBeNull();
    expect(container.querySelector('[data-editor-mode="source"]')).not.toBeNull();
  });

  it("ignores stale Viewer cleanup after a newer contribution takes ownership", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    let contribution: EditorPaneMenuContribution | null = null;
    let publishFirst: ((value: EditorPaneMenuContribution | null) => void) | null = null;
    let publishSecond: ((value: EditorPaneMenuContribution | null) => void) | null = null;

    act(() => root?.render(
      <EditorPaneMenuContributionProvider
        onContributionChange={(value) => {
          contribution = value;
        }}
      >
        <PublisherCapture onReady={(publish) => { publishFirst = publish; }} />
        <PublisherCapture onReady={(publish) => { publishSecond = publish; }} />
      </EditorPaneMenuContributionProvider>,
    ));

    const first = createContribution("first");
    const second = createContribution("second");
    act(() => publishFirst?.(first));
    act(() => publishSecond?.(second));
    act(() => publishFirst?.(null));
    expect(contribution).toBe(second);
    act(() => publishSecond?.(null));
    expect(contribution).toBeNull();
  });
});

function PublisherCapture({
  onReady,
}: Readonly<{
  onReady: (publish: (value: EditorPaneMenuContribution | null) => void) => void;
}>) {
  const publish = useEditorPaneMenuContributionPublisher();
  useLayoutEffect(() => {
    if (publish) onReady(publish);
  }, [onReady, publish]);
  return null;
}

function createContribution(documentId: string): EditorPaneMenuContribution {
  return { documentId, viewItems: [] };
}
