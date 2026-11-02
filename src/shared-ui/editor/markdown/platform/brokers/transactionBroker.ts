import { EditorSelection, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { SourceRange } from "../../core/plans/markdownPlanTypes";

export type EmbeddedCommitRequest = {
  mappedRange: SourceRange;
  baseSource: string;
  baseRevision: string;
  nextSource: string;
  selection?: { from: number; to: number };
  preserveSelection?: boolean;
  effects?: TransactionSpec["effects"];
  /** Explicit optimistic rebase for edits outside the mapped source range. */
  rebase?: "if-source-unchanged";
};

export type CommitResult = {
  ok: boolean;
  mappedTo: SourceRange | null;
};

const revisionByDocument = new WeakMap<object, string>();
let documentRevisionSequence = 0n;

/**
 * Return an opaque identity for an immutable CodeMirror document snapshot.
 * CodeMirror creates a new Text object for every changed document, so object
 * identity is collision-free inside this runtime and remains O(1) for large
 * documents. It intentionally does not pretend that length/line-count is a
 * revision: same-sized replacements are different snapshots.
 */
export function getDocRevision(doc: object): string {
  const existing = revisionByDocument.get(doc);
  if (existing) return existing;
  documentRevisionSequence += 1n;
  const revision = `doc-revision:${documentRevisionSequence}`;
  revisionByDocument.set(doc, revision);
  return revision;
}

/**
 * Validates an embedded edit session's base revision/source and builds a
 * single CodeMirror transaction that commits source + mapped selection.
 */
export function createTransactionBroker() {
  return {
    buildCommit(view: EditorView, request: EmbeddedCommitRequest): TransactionSpec | null {
      if (view.state.readOnly) return null;
      return buildValidatedCommit(view, request);
    },

    commit(view: EditorView, request: EmbeddedCommitRequest): CommitResult {
      if (view.state.readOnly) return { ok: false, mappedTo: null };

      const spec = buildValidatedCommit(view, request);
      if (!spec) return { ok: false, mappedTo: null };

      view.dispatch(spec);
      const newTo = request.mappedRange.from + request.nextSource.length;
      return { ok: true, mappedTo: { from: request.mappedRange.from, to: newTo } };
    },
  };
}

function buildValidatedCommit(
  view: EditorView,
  request: EmbeddedCommitRequest,
): TransactionSpec | null {
  const { from, to } = request.mappedRange;
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < from ||
    to > view.state.doc.length
  ) {
    return null;
  }

  const currentRevision = getDocRevision(view.state.doc);
  const revisionMatches = request.baseRevision === currentRevision;
  if (!revisionMatches && request.rebase !== "if-source-unchanged") return null;

  // Compare-and-swap is the rebase boundary. Changes outside the mapped range
  // are safe when explicitly opted in; any overlap changes the exact source and
  // is rejected without overwriting the external/Agent edit.
  if (view.state.sliceDoc(from, to) !== request.baseSource) return null;

  const newTo = from + request.nextSource.length;
  const nextDocumentLength = view.state.doc.length - (to - from) + request.nextSource.length;
  if (request.selection) {
    const selectionRange = request.selection;
    if (
      !Number.isInteger(selectionRange.from) ||
      !Number.isInteger(selectionRange.to) ||
      selectionRange.from < 0 ||
      selectionRange.to < 0 ||
      selectionRange.from > nextDocumentLength ||
      selectionRange.to > nextDocumentLength
    ) {
      return null;
    }
  }

  return {
    changes: {
      from,
      to,
      insert: request.nextSource,
    },
    selection: request.preserveSelection
      ? undefined
      : request.selection
        ? EditorSelection.range(request.selection.from, request.selection.to)
        : EditorSelection.cursor(newTo),
    effects: request.effects,
  };
}

export type TransactionBroker = ReturnType<typeof createTransactionBroker>;
