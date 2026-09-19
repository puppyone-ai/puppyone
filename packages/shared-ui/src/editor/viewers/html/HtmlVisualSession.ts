import { ChangeSet, type ChangeDesc } from "@codemirror/state";
import { CodeMirrorDocumentModel, externalDocumentUpdate } from "../../document-session/CodeMirrorDocumentModel";
import { compileHtmlEdit, readHtmlTarget, type HtmlEditOperation } from "./htmlEditCompiler";
import { HTML_VISUAL_MAX_CHARS, parseHtmlSource, type HtmlSourceIndex } from "./htmlSourceIndex";

export type HtmlPreviewPatch = { id: string; kind: "text"; value: string; lineBreaks: boolean }
  | { id: string; kind: "attribute"; name: "src" | "alt" | "style"; value: string | null };

/** One view's mapping lease. An external/source/history transaction retires the complete lease. */
export class HtmlVisualSession {
  readonly id = crypto.randomUUID();
  readonly index: HtmlSourceIndex;
  private changes: ChangeDesc | null = null;
  private applying = false;
  private active = true;
  private readonly unsubscribe: () => void;

  constructor(readonly model: CodeMirrorDocumentModel, path: string, onInvalidated: () => void) {
    this.index = parseHtmlSource(model.readSnapshot().content, path);
    this.unsubscribe = model.subscribeTransactions((transaction) => {
      if (!this.active) return;
      if (!this.applying || transaction.annotation(externalDocumentUpdate)) {
        this.active = false;
        onInvalidated();
      }
    });
  }

  get valid(): boolean { return this.active && !this.model.retired && this.index.editable; }

  read(id: string) {
    const target = this.index.targets.get(id);
    if (!this.valid || !target) throw new Error("stale");
    return readHtmlTarget(target, this.changes, this.model.editorState);
  }

  validate(id: string, operation: HtmlEditOperation): void {
    const target = this.index.targets.get(id);
    if (!this.valid || !target || !this.model.editable) throw new Error("stale");
    compileHtmlEdit(target, this.changes, this.model.editorState, operation);
  }

  apply(id: string, baseRevision: string, operation: HtmlEditOperation, gesture: string): HtmlPreviewPatch[] {
    const target = this.index.targets.get(id);
    if (!this.valid || !target || baseRevision !== this.model.revision) throw new Error("stale");
    const edits = compileHtmlEdit(target, this.changes, this.model.editorState, operation);
    if (edits.length === 0) return [];
    const added = edits.reduce((sum, edit) => sum + edit.insert.length - (edit.to - edit.from), 0);
    if (this.model.editorState.doc.length + added > HTML_VISUAL_MAX_CHARS
      || operation.kind !== "text" && this.read(id).opening.length + added > 32768) throw new Error("unsupported");
    const changeSet = ChangeSet.of(edits, this.model.editorState.doc.length, "\n");
    this.applying = true;
    try {
      if (!this.model.applyLocalEdits(baseRevision, edits, gesture)) throw new Error("stale");
      this.changes = this.changes ? this.changes.composeDesc(changeSet) : changeSet;
    } finally { this.applying = false; }
    const current = this.read(id);
    if (operation.kind === "text") return [{ id, kind: "text", value: current.text, lineBreaks: !["pre", "code"].includes(current.tag) }];
    const name = operation.kind === "style" ? "style" : operation.name;
    return [{ id, kind: "attribute", name, value: current.attrs.get(name) ?? null }];
  }

  dispose(): void { this.active = false; this.unsubscribe(); }
}
