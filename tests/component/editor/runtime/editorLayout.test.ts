// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { commitEditorLayout, registerEditorLayoutParticipant } from "../../../../packages/shared-ui/src/editor/runtime/editorLayout";

describe("editor layout host boundary", () => {
  it("prepares all affected panes before mutation and commits only surviving panes", () => {
    const root = document.createElement("div");
    const left = root.appendChild(document.createElement("div"));
    const right = root.appendChild(document.createElement("div"));
    const unrelated = document.createElement("div");
    document.body.append(root, unrelated);
    const calls: string[] = [];
    const release = [left, right, unrelated].map((element, index) => registerEditorLayoutParticipant(element, {
      prepare: () => calls.push(`prepare:${index}`),
      commit: () => calls.push(`commit:${index}`),
    }));
    commitEditorLayout(root, () => { calls.push("mutation"); right.remove(); });
    expect(calls).toEqual(["prepare:0", "prepare:1", "mutation", "commit:0"]);
    release.forEach(dispose => dispose());
    calls.length = 0;
    commitEditorLayout(root, () => calls.push("mutation"));
    expect(calls).toEqual(["mutation"]);
    root.remove(); unrelated.remove();
  });

  it("settles partial mutations even when the host operation throws", () => {
    const root = document.body.appendChild(document.createElement("div"));
    let width = "";
    const release = registerEditorLayoutParticipant(root, { prepare() {}, commit() { width = root.style.width; } });
    expect(() => commitEditorLayout(root, () => { root.style.width = "250px"; throw new Error("cancel"); })).toThrow("cancel");
    expect(width).toBe("250px");
    release(); release(); root.remove();
  });

  it("does not commit an unregistered view after a host mutation replaced it", () => {
    const root = document.body.appendChild(document.createElement("div"));
    const calls: string[] = [];
    const release = registerEditorLayoutParticipant(root, { prepare() {}, commit() { calls.push("old"); } });
    let releaseReplacement = () => {};
    commitEditorLayout(root, () => {
      releaseReplacement = registerEditorLayoutParticipant(root, { prepare() {}, commit() { calls.push("new"); } });
      release();
    });
    expect(calls).toEqual([]);
    commitEditorLayout(root, () => {});
    expect(calls).toEqual(["new"]);
    releaseReplacement(); root.remove();
  });
});
