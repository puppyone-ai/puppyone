import { describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import { createCodeMirrorLayoutEngine } from "../../../../packages/shared-ui/src/editor/codemirror/layoutEngine";

describe("CodeMirror application compatibility contract", () => {
  it("proves the queued measurement ran synchronously through public APIs", () => {
    type Request = NonNullable<Parameters<EditorView["requestMeasure"]>[0]>;
    let pending: Request | undefined;
    const view = { state: { doc: { length: 20 } },
      requestMeasure: (request: Request) => { pending = request; },
      coordsAtPos: vi.fn(() => { pending?.read(view as unknown as EditorView); }),
    };
    createCodeMirrorLayoutEngine(view as unknown as EditorView).flush(30);
    expect(view.coordsAtPos).toHaveBeenCalledExactlyOnceWith(20, 1);
  });
  it("fails explicitly if an engine upgrade stops flushing coordinate queries", () => {
    const view = { state: { doc: { length: 20 } }, requestMeasure: vi.fn(), coordsAtPos: vi.fn() };
    expect(() => createCodeMirrorLayoutEngine(view as unknown as EditorView).flush(0)).toThrow("synchronous measurement unavailable");
  });
});
