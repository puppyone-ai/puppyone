/** @vitest-environment happy-dom */
import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { markdownLivePreviewFocusEffect } from "../../../../../../packages/shared-ui/src/editor/markdown/core/state/livePreviewFocus";
import {
  markdownCodeMirrorBaseExtensions,
  markdownLivePreviewExtension,
} from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";

const views: EditorView[] = [];
const snapshotOwners = new WeakMap<StateEffect<unknown>, "left" | "right">();

type RecordedFocusTransaction = Readonly<{
  focused: boolean;
  snapshots: readonly ("left" | "right")[];
}>;

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Markdown focus scroll continuity", () => {
  it("commits focus projection and the owning view snapshot in the same transaction", async () => {
    const leftTransactions: RecordedFocusTransaction[] = [];
    const rightTransactions: RecordedFocusTransaction[] = [];
    const left = createView("Left **document**\n\nMore content", leftTransactions);
    const right = createView("Right **document**\n\nMore content", rightTransactions);
    const leftSnapshot = left.scrollSnapshot.bind(left);
    vi.spyOn(left, "scrollSnapshot").mockImplementation(() => {
      const snapshot = leftSnapshot();
      snapshotOwners.set(snapshot, "left");
      return snapshot;
    });
    const rightSnapshot = right.scrollSnapshot.bind(right);
    vi.spyOn(right, "scrollSnapshot").mockImplementation(() => {
      const snapshot = rightSnapshot();
      snapshotOwners.set(snapshot, "right");
      return snapshot;
    });

    left.focus();
    await settleFocusChange();
    expect(leftTransactions).toEqual([{ focused: true, snapshots: ["left"] }]);
    expect(rightTransactions).toEqual([]);

    right.focus();
    await settleFocusChange();
    expect(leftTransactions).toEqual([
      { focused: true, snapshots: ["left"] },
      { focused: false, snapshots: ["left"] },
    ]);
    expect(rightTransactions).toEqual([{ focused: true, snapshots: ["right"] }]);

    left.focus();
    await settleFocusChange();
    expect(leftTransactions.at(-1)).toEqual({ focused: true, snapshots: ["left"] });
    expect(rightTransactions.at(-1)).toEqual({ focused: false, snapshots: ["right"] });
  });

  it("captures exactly one editor-local snapshot per boundary over repeated pane switches", async () => {
    const left = createView("Left **document**\n\nMore content", []);
    const right = createView("Right **document**\n\nMore content", []);
    const leftSnapshot = vi.spyOn(left, "scrollSnapshot");
    const rightSnapshot = vi.spyOn(right, "scrollSnapshot");

    left.focus();
    await settleFocusChange();
    for (let cycle = 0; cycle < 8; cycle += 1) {
      right.focus();
      await settleFocusChange();
      left.focus();
      await settleFocusChange();
    }

    expect(leftSnapshot).toHaveBeenCalledTimes(17);
    expect(rightSnapshot).toHaveBeenCalledTimes(16);
  });
});

function createView(
  source: string,
  focusTransactions: RecordedFocusTransaction[],
): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: source,
      extensions: [
        ...markdownCodeMirrorBaseExtensions(false),
        markdownLivePreviewExtension("safe", null, "note.md"),
        EditorView.updateListener.of((update) => {
          for (const transaction of update.transactions) {
            const focus = transaction.effects.find(
              (effect) => effect.is(markdownLivePreviewFocusEffect),
            );
            if (!focus) continue;
            focusTransactions.push({
              focused: focus.value,
              snapshots: transaction.effects
                .filter((effect) => snapshotOwners.has(effect))
                .map((effect) => snapshotOwners.get(effect)!),
            });
          }
        }),
      ],
    }),
  });
  views.push(view);
  return view;
}

async function settleFocusChange() {
  await new Promise((resolve) => window.setTimeout(resolve, 20));
}
