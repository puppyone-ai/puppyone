import { ChangeSet, type ChangeDesc } from "@codemirror/state";
import { CodeMirrorDocumentModel, externalDocumentUpdate } from "../../document-session/CodeMirrorDocumentModel";
import { compileHtmlEdit, readHtmlTarget, type HtmlEditOperation, type HtmlStructuralAction } from "./htmlEditCompiler";
import { currentTarget, HTML_VISUAL_MAX_CHARS, parseHtmlSource, type HtmlSourceIndex } from "./htmlSourceIndex";

export type HtmlPreviewPatch =
  | { id: string; kind: "text"; value: string; lineBreaks: boolean }
  | { id: string; kind: "attribute"; name: "src" | "alt" | "style" | "href"; value: string | null }
  | { id: string; kind: "structure"; action: HtmlStructuralAction; ids: string[]; selectId: string | null };

/** One view's mapping lease. An external/source/history transaction retires the complete lease. */
export class HtmlVisualSession {
  readonly id = crypto.randomUUID();
  index: HtmlSourceIndex;
  private changes: ChangeDesc | null = null;
  private applying = false;
  private active = true;
  private readonly unsubscribe: () => void;

  constructor(readonly model: CodeMirrorDocumentModel, readonly path: string, onInvalidated: () => void) {
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

  private resolveOperation(targetId: string, operation: HtmlEditOperation): HtmlEditOperation {
    if (operation.kind !== "structure") return operation;
    const target = this.index.targets.get(targetId);
    if (!target) throw new Error("stale");
    let siblingId: string | null = null;
    if (operation.action === "move-up") siblingId = target.prevSiblingId;
    else if (operation.action === "move-down") siblingId = target.nextSiblingId;
    const siblingTarget = siblingId ? this.index.targets.get(siblingId) ?? null : null;
    return { ...operation, siblingTarget };
  }

  validate(id: string, operation: HtmlEditOperation): void {
    const target = this.index.targets.get(id);
    if (!this.valid || !target || !this.model.editable) throw new Error("stale");
    compileHtmlEdit(target, this.changes, this.model.editorState, this.resolveOperation(id, operation));
  }

  apply(id: string, baseRevision: string, operation: HtmlEditOperation, gesture: string): HtmlPreviewPatch[] {
    const target = this.index.targets.get(id);
    if (!this.valid || !target || baseRevision !== this.model.revision) throw new Error("stale");
    const resolved = this.resolveOperation(id, operation);
    const beforeCurrent = currentTarget(target, this.changes, this.model.editorState);
    const edits = compileHtmlEdit(target, this.changes, this.model.editorState, resolved);
    if (edits.length === 0) return [];
    const added = edits.reduce((sum, edit) => sum + edit.insert.length - (edit.to - edit.from), 0);
    if (this.model.editorState.doc.length + added > HTML_VISUAL_MAX_CHARS
      || resolved.kind !== "text" && resolved.kind !== "structure" && this.read(id).opening.length + added > 32768) {
      throw new Error("unsupported");
    }
    const changeSet = ChangeSet.of(edits, this.model.editorState.doc.length, "\n");
    this.applying = true;
    try {
      if (!this.model.applyLocalEdits(baseRevision, edits, gesture)) throw new Error("stale");
      this.changes = this.changes ? this.changes.composeDesc(changeSet) : changeSet;
    } finally { this.applying = false; }
    if (resolved.kind === "structure") {
      let expectedStart: number | null = null;
      if (resolved.action === "duplicate") {
        const edit = edits[0]!;
        const leadingMatch = /^(\r?\n[ \t]*)/.exec(edit.insert);
        expectedStart = beforeCurrent.end + (leadingMatch ? leadingMatch[0].length : 0);
      } else if (resolved.action === "move-up" && resolved.siblingTarget) {
        expectedStart = edits[0]!.from;
      } else if (resolved.action === "move-down" && resolved.siblingTarget) {
        const edit = edits[0]!;
        const elementLen = beforeCurrent.end - beforeCurrent.start;
        expectedStart = edit.from + edit.insert.length - elementLen;
      }
      this.index = parseHtmlSource(this.model.readSnapshot().content, this.path);
      this.changes = null;
      let selectId: string | null = null;
      if (expectedStart !== null) {
        for (const [candidateId, candidate] of this.index.targets) {
          if (candidate.start === expectedStart && candidate.tag === target.tag) {
            selectId = candidateId;
            break;
          }
        }
      }
      return [{ id, kind: "structure", action: resolved.action, ids: [...this.index.targets.keys()], selectId }];
    }
    const current = this.read(id);
    if (resolved.kind === "text") return [{ id, kind: "text", value: current.text, lineBreaks: !["pre", "code"].includes(current.tag) }];
    const name = resolved.kind === "style" ? "style" : resolved.name;
    return [{ id, kind: "attribute", name, value: current.attrs.get(name) ?? null }];
  }

  dispose(): void { this.active = false; this.unsubscribe(); }
}
