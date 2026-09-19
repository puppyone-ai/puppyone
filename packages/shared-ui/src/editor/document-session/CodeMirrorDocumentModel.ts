import { history, historyField, isolateHistory, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import {
  Annotation, Compartment, EditorState, StateEffect, Text, Transaction,
  type Extension, type TransactionSpec,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { EditorSourceSnapshot, EditorSourceSnapshotPort } from "../sourceSnapshot";
import { DOCUMENT_HISTORY_POLICY } from "./historyPolicy";

export const externalDocumentUpdate = Annotation.define<boolean>();
const localEditGroup = Annotation.define<string>();
export type DocumentTextEdit = Readonly<{ from: number; to: number; expectedText: string; insert: string }>;
const revisions = new WeakMap<object, string>();
let revisionSequence = 0;

export function getCodeMirrorDocumentRevision(document: object): string {
  let revision = revisions.get(document);
  if (!revision) {
    revision = `editor-model:${++revisionSequence}`;
    revisions.set(document, revision);
  }
  return revision;
}

/** A document survives its views. Detached states contain no view plugins or callbacks. */
export class CodeMirrorDocumentModel implements EditorSourceSnapshotPort {
  readonly retainedSource = this;
  private readonly historySlot = new Compartment();
  private state: EditorState;
  private view: EditorView | null = null;
  private scroll: StateEffect<unknown> | undefined;
  private historyChangeBytes = 0;
  private disposed = false;
  private inputEnabled = true;
  private readonly listeners = new Set<(transaction: Transaction) => void>();
  private editGroup: string | null = null;

  constructor(content: string, private readonly revisionOf = getCodeMirrorDocumentRevision,
    private readonly preserveLineEndings = false) {
    this.state = EditorState.create({ doc: preserveLineEndings ? Text.of(content.split("\n")) : content, extensions: this.coreExtensions() });
  }

  get editorState(): EditorState { return this.view?.state ?? this.state; }
  get revision(): string { return this.revisionOf(this.editorState.doc); }
  get editable(): boolean { return this.inputEnabled && !this.disposed; }
  get retired(): boolean { return this.disposed; }

  subscribeTransactions(listener: (transaction: Transaction) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Compare and apply one complete local operation, including when no view is mounted. */
  applyLocalEdits(baseRevision: string, edits: readonly DocumentTextEdit[], group: string): boolean {
    if (!this.editable || baseRevision !== this.revision || edits.length === 0) return false;
    const state = this.editorState;
    let end = -1;
    let previousStart = -1;
    const ordered = [...edits].sort((a, b) => a.from - b.from);
    for (const edit of ordered) {
      if (!Number.isInteger(edit.from) || !Number.isInteger(edit.to) || edit.from < 0
        || edit.to < edit.from || edit.to > state.doc.length || edit.from < end || edit.from === previousStart
        || state.doc.sliceString(edit.from, edit.to) !== edit.expectedText) return false;
      end = edit.to;
      previousStart = edit.from;
    }
    if (ordered.every((edit) => edit.expectedText === edit.insert)) return true;
    this.dispatch({ changes: ordered,
      // CodeMirror's compose events join an explicitly continuing gesture even across pauses.
      annotations: [localEditGroup.of(group), Transaction.userEvent.of(this.editGroup === group ? "input.type.compose" : "input.type.compose.start"),
        ...(this.editGroup === group ? [] : [isolateHistory.of("before")])],
    });
    if (this.editorState.doc === state.doc) return false;
    this.editGroup = group;
    return true;
  }

  moveHistory(direction: "undo" | "redo"): boolean {
    if (!this.editable) return false;
    this.editGroup = null;
    return (direction === "undo" ? undo : redo)({ state: this.editorState, dispatch: (transaction) => this.dispatch(transaction) });
  }

  createViewState(extensions: Extension): EditorState {
    if (this.disposed) throw new Error("The editor model has been retired.");
    if (this.view) throw new Error("A document may only have one editable view.");
    this.state = this.state.update({
      effects: StateEffect.reconfigure.of([this.coreExtensions(), extensions]),
    }).state;
    return this.state;
  }

  attachView(view: EditorView): void {
    this.view = view;
  }

  getScrollSnapshot(): StateEffect<unknown> | undefined { return this.scroll; }

  detachView(view: EditorView): void {
    if (this.view !== view) return;
    this.scroll = view.scrollSnapshot();
    this.state = view.state.update({ effects: StateEffect.reconfigure.of(this.coreExtensions()) }).state;
    this.view = null;
    this.trimHistory();
  }

  acceptTransactions(transactions: readonly Transaction[], view: EditorView): void {
    view.update(transactions);
    this.state = view.state;
    for (const transaction of transactions) {
      this.recordTransaction(transaction);
    }
    // History's own event limit bounds ordinary typing. Serialize only after
    // substantial edits or at detach, never stringify the document per key.
    if (this.historyChangeBytes > DOCUMENT_HISTORY_POLICY.maxBytes
      || undoDepth(this.state) + redoDepth(this.state) > DOCUMENT_HISTORY_POLICY.maxEntries) this.trimHistory();
  }

  readSnapshot = (): EditorSourceSnapshot => {
    const state = this.view?.state ?? this.state;
    return { content: state.doc.toString(), revision: this.revisionOf(state.doc) };
  };

  replaceContent = (content: string): EditorSourceSnapshot => this.replaceContentWithEffects(content);

  replaceContentWithEffects = (content: string, effects: readonly StateEffect<unknown>[] = []): EditorSourceSnapshot => {
    const state = this.view?.state ?? this.state;
    this.dispatch({
      changes: { from: 0, to: state.doc.length, insert: content },
      effects: [this.historySlot.reconfigure([]), ...effects],
      annotations: [externalDocumentUpdate.of(true), Transaction.addToHistory.of(false)],
    });
    this.dispatch({ effects: this.historySlot.reconfigure(this.historyExtension()) });
    this.historyChangeBytes = 0;
    this.editGroup = null;
    return this.readSnapshot();
  };

  prepareDetach = (): void => {
    // Blur commits the native composition where supported. If composition is
    // still live the operation must retain the view and be retried, not drop it.
    if (!this.view?.composing) return;
    this.view.contentDOM.blur();
    if (this.view.composing) throw new Error("Finish the current text composition before closing this document.");
  };

  setInputEnabled = (enabled: boolean): void => { this.inputEnabled = enabled; };

  dispose = (): void => {
    this.disposed = true;
    this.inputEnabled = false;
    this.view = null;
    this.scroll = undefined;
    this.listeners.clear();
    this.state = EditorState.create();
  };

  private historyExtension(): Extension {
    return history({ minDepth: DOCUMENT_HISTORY_POLICY.maxEntries });
  }

  private coreExtensions(): Extension {
    return [this.preserveLineEndings ? EditorState.lineSeparator.of("\n") : [], this.historySlot.of(this.historyExtension()), EditorState.transactionFilter.of((transaction) => (
      this.inputEnabled || !transaction.docChanged || transaction.annotation(externalDocumentUpdate) ? transaction : []
    ))];
  }

  private dispatch(spec: TransactionSpec | Transaction): void {
    if (this.view) {
      this.view.dispatch(spec);
      this.state = this.view.state;
    } else {
      const transaction = spec instanceof Transaction ? spec : this.state.update(spec);
      this.scroll = this.scroll?.map(transaction.changes);
      this.state = transaction.state;
      this.recordTransaction(transaction);
      if (transaction.docChanged && (this.historyChangeBytes > DOCUMENT_HISTORY_POLICY.maxBytes
        || undoDepth(this.state) + redoDepth(this.state) > DOCUMENT_HISTORY_POLICY.maxEntries)) this.trimHistory();
    }
  }

  private recordTransaction(transaction: Transaction): void {
    if (!transaction.docChanged && !transaction.annotation(externalDocumentUpdate)) return;
    if (!transaction.annotation(localEditGroup)) this.editGroup = null;
    if (!transaction.annotation(externalDocumentUpdate)) transaction.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
      this.historyChangeBytes += (to - from + inserted.length) * 2;
    });
    for (const listener of this.listeners) listener(transaction);
  }

  private trimHistory(): void {
    const state = this.view?.state ?? this.state;
    const json = state.toJSON({ history: historyField }) as {
      doc: string; selection: unknown; history: { done: unknown[]; undone: unknown[] };
    };
    let remainingBytes = DOCUMENT_HISTORY_POLICY.maxBytes;
    let remainingEntries = DOCUMENT_HISTORY_POLICY.maxEntries;
    const trim = (events: unknown[]) => {
      const retained: unknown[] = [];
      for (let index = events.length - 1; index >= 0 && remainingEntries > 0; index--) {
        const bytes = JSON.stringify(events[index]).length * 2;
        if (bytes > remainingBytes) break;
        remainingBytes -= bytes;
        remainingEntries--;
        retained.unshift(events[index]);
      }
      return retained;
    };
    const done = trim(json.history.done);
    const undone = trim(json.history.undone);
    if (done.length !== json.history.done.length || undone.length !== json.history.undone.length) {
      const restored = EditorState.fromJSON({ ...json, history: { done, undone } }, {
        extensions: this.historyExtension(),
      }, { history: historyField });
      this.dispatch({ effects: this.historySlot.reconfigure([]) });
      this.dispatch({ effects: this.historySlot.reconfigure([
        this.historyExtension(), historyField.init(() => restored.field(historyField)),
      ]) });
    }
    this.historyChangeBytes = DOCUMENT_HISTORY_POLICY.maxBytes - remainingBytes;
  }
}
