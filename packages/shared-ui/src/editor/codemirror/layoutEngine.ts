import type { EditorView } from "@codemirror/view";
import contract from "./layoutEngineContract.json";

/** Application-owned compatibility boundary, NOT an upstream flush API.
 * Dependency/lockfile checks pin the reviewed engine. A public measurement
 * sentinel verifies that the coordinate query actually completed this batch.
 * Failure is isolated to this view by the document layout scheduler. */
export function createCodeMirrorLayoutEngine(view: EditorView) {
  const measureKey = {};
  return {
    flush(position: number) {
      let measured = false;
      view.requestMeasure({ key: measureKey, read: () => { measured = true; } });
      view.coordsAtPos(Math.min(position, view.state.doc.length), 1);
      if (!measured) throw new Error(`${contract.id}: synchronous measurement unavailable; review the CodeMirror adapter`);
    },
  };
}
