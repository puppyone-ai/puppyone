import { StateEffect, StateField } from "@codemirror/state";
import type { MarkdownTableFocusTarget } from "./tableModel";

export type MarkdownTableFocusRequest = {
  requestId: number;
  tableFrom: number;
} & MarkdownTableFocusTarget;

type MarkdownTableFocusAction =
  | { type: "request"; request: MarkdownTableFocusRequest }
  | { type: "clear"; requestId: number };

export type MarkdownTableFocusState = MarkdownTableFocusRequest | null;

export const markdownTableFocusEffect = StateEffect.define<MarkdownTableFocusAction>();

let nextMarkdownTableFocusRequestId = 1;

/**
 * Editor-scoped pending table focus. Replaces the previous module-global
 * pendingMarkdownTableFocus store (architecture §4.3 / Phase 5).
 */
export const markdownTableFocusField = StateField.define<MarkdownTableFocusState>({
  create() {
    return null;
  },
  update(value, transaction) {
    let next = value && transaction.docChanged
      ? { ...value, tableFrom: transaction.changes.mapPos(value.tableFrom, 1) }
      : value;
    for (const effect of transaction.effects) {
      if (!effect.is(markdownTableFocusEffect)) continue;
      if (effect.value.type === "request") {
        // Request coordinates are expressed in the transaction's resulting
        // document. Map only state carried in from an older transaction.
        next = effect.value.request;
      } else if (next?.requestId === effect.value.requestId) {
        next = null;
      }
    }
    return next;
  },
});

export function requestMarkdownTableFocus(
  tableFrom: number,
  focus: MarkdownTableFocusTarget,
) {
  return markdownTableFocusEffect.of({
    type: "request",
    request: {
      requestId: nextMarkdownTableFocusRequestId++,
      tableFrom,
      ...focus,
    },
  });
}

export function clearMarkdownTableFocus(requestId: number) {
  return markdownTableFocusEffect.of({ type: "clear", requestId });
}
