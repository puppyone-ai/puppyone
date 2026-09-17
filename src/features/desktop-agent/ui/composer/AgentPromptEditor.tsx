import { useEffect, useLayoutEffect, useRef } from "react";
import { subscribeTypographyChanges, useEditorAppearanceRevision } from "@puppyone/shared-ui";
import { bidiIsolate, type MessageFormatter } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import { defaultKeymap, history, historyKeymap, insertNewlineAndIndent } from "@codemirror/commands";
import { Compartment, EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  keymap,
  placeholder as placeholderExtension,
  type DecorationSet,
} from "@codemirror/view";
import type { AgentDraftReference, AgentPromptReferenceMention } from "../../domain/agent-contract";
import type { AgentReferenceDropEvent } from "../agentReferenceDropEvent";
import {
  agentPromptMentionText,
  isAgentMediaReference,
  normalizeAgentPromptMentions,
} from "../../domain/agent-prompt-mentions";
import { localizedReferenceError } from "./agent-reference-presentation";

type AgentPromptEditorProps = {
  focusRequest?: number;
  value: string;
  mentions: AgentPromptReferenceMention[];
  references: AgentDraftReference[];
  disabled: boolean;
  placeholder: string;
  ariaLabel: string;
  onChange: (value: string, mentions: AgentPromptReferenceMention[]) => void;
  onRemoveReference?: (id: string) => void;
  onRetryReference?: (id: string) => void;
  onDrop?: (event: AgentReferenceDropEvent) => void;
  onPaste?: (event: { clipboardData: DataTransfer; preventDefault: () => void; defaultPrevented: boolean }) => void;
  onSubmit: () => void;
};

type AgentPromptReferenceDecoration = AgentPromptReferenceMention & {
  label: string;
  title: string;
  referenceKind: AgentDraftReference["kind"];
  status: AgentDraftReference["status"];
  errorLabel: string;
  retryLabel: string;
  removeLabel: string;
  onRetry?: (id: string) => void;
};

const retryMentionRemoval = StateEffect.define<string>();

class AgentPromptReferenceWidget extends WidgetType {
  constructor(private readonly reference: AgentPromptReferenceDecoration) {
    super();
  }

  override eq(other: AgentPromptReferenceWidget) {
    return this.reference.label === other.reference.label
      && this.reference.title === other.reference.title
      && this.reference.referenceId === other.reference.referenceId
      && this.reference.referenceKind === other.reference.referenceKind
      && this.reference.status === other.reference.status
      && this.reference.onRetry === other.reference.onRetry;
  }

  override toDOM(view: EditorView) {
    const element = document.createElement("span");
    element.className = `desktop-agent-prompt-mention is-${this.reference.status}`;
    element.title = this.reference.title;
    element.dataset.referenceId = this.reference.referenceId;
    element.dataset.referenceKind = this.reference.referenceKind;
    element.dataset.referenceStatus = this.reference.status;
    element.dataset.atomic = "true";
    element.contentEditable = "false";
    const label = document.createElement("span");
    label.className = "desktop-agent-prompt-mention-label";
    label.textContent = this.reference.label;
    element.append(label);
    if (this.reference.status === "error") {
      const error = document.createElement("span");
      error.className = "desktop-agent-visually-hidden";
      error.textContent = this.reference.errorLabel;
      let retry: HTMLButtonElement | null = null;
      if (this.reference.onRetry) {
        retry = document.createElement("button");
        retry.type = "button";
        retry.className = "desktop-agent-prompt-mention-action is-retry";
        retry.setAttribute("aria-label", this.reference.retryLabel);
        retry.textContent = "↻";
        retry.addEventListener("mousedown", preventEditorSelection);
        retry.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.reference.onRetry?.(this.reference.referenceId);
          removeMentionFromEditor(view, this.reference, true);
        });
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "desktop-agent-prompt-mention-action is-remove";
      remove.setAttribute("aria-label", this.reference.removeLabel);
      remove.textContent = "×";
      remove.addEventListener("mousedown", preventEditorSelection);
      remove.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        removeMentionFromEditor(view, this.reference);
      });
      element.append(error, ...(retry ? [retry] : []), remove);
    }
    return element;
  }

  override ignoreEvent(event: Event) {
    return event.target instanceof HTMLButtonElement;
  }
}

const replaceMentionDecorations = StateEffect.define<AgentPromptReferenceDecoration[]>();
const mentionDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(replaceMentionDecorations)) continue;
      next = Decoration.set(effect.value.map((mention) => Decoration.replace({
        widget: new AgentPromptReferenceWidget(mention),
        inclusive: false,
        referenceId: mention.referenceId,
      }).range(mention.start, mention.end)), true);
    }
    return next;
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});

/**
 * A small structured editor: plain prompt text plus atomic reference ranges.
 * CodeMirror owns selection, IME, undo and drag-position behavior; the app owns
 * semantic reference ids and never encodes authorization into DOM text.
 */
export function AgentPromptEditor({
  focusRequest,
  value,
  mentions,
  references,
  disabled,
  placeholder,
  ariaLabel,
  onChange,
  onRemoveReference,
  onRetryReference,
  onDrop,
  onPaste,
  onSubmit,
}: AgentPromptEditorProps) {
  const { t } = useLocalization();
  const hostRef = useRef<HTMLDivElement>(null);
  const appearanceRevision = useEditorAppearanceRevision();
  const viewRef = useRef<EditorView | null>(null);
  const lastFocusRequest = useRef<number | undefined>(undefined);
  const editableCompartmentRef = useRef(new Compartment());
  const placeholderCompartmentRef = useRef(new Compartment());
  const callbacksRef = useRef({ onChange, onRemoveReference, onDrop, onPaste, onSubmit });
  callbacksRef.current = { onChange, onRemoveReference, onDrop, onPaste, onSubmit };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        mentionDecorations,
        history(),
        EditorView.lineWrapping,
        EditorState.tabSize.of(2),
        editableCompartmentRef.current.of(EditorView.editable.of(!disabled)),
        EditorView.contentAttributes.of({ "aria-label": ariaLabel, role: "textbox", "aria-multiline": "true" }),
        placeholderCompartmentRef.current.of(placeholderExtension(placeholder)),
        Prec.high(keymap.of([{
          key: "Enter",
          run: (view) => {
            // Composition starts before its first document change. Leave its
            // confirmation key to the IME, without submitting or inserting a newline.
            if (view.compositionStarted) return false;
            callbacksRef.current.onSubmit();
            return true;
          },
          shift: (view) => view.compositionStarted ? false : insertNewlineAndIndent(view),
        }])),
        // A fallback Enter binding would insert a newline when the IME guard declines.
        keymap.of([...defaultKeymap.filter((binding) => binding.key !== "Enter"), ...historyKeymap]),
        EditorView.domEventHandlers({
          drop: (event) => {
            if (event.dataTransfer) callbacksRef.current.onDrop?.({
              dataTransfer: event.dataTransfer,
              preventDefault: () => event.preventDefault(),
              stopPropagation: () => event.stopPropagation(),
              defaultPrevented: event.defaultPrevented,
            });
            // Returning true is essential: it prevents CodeMirror's native
            // text/file drop path from serializing an internal Resource URI
            // into the visible prompt before semantic ingestion runs.
            return event.defaultPrevented;
          },
          paste: (event) => {
            if (event.clipboardData) callbacksRef.current.onPaste?.({
              clipboardData: event.clipboardData,
              preventDefault: () => event.preventDefault(),
              defaultPrevented: event.defaultPrevented,
            });
            return event.defaultPrevented;
          },
          dragover: (event, view) => {
            const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (position !== null) view.dispatch({ selection: { anchor: position } });
            return false;
          },
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const nextMentions = readMentions(update.state);
          const previousIds = new Set(readMentions(update.startState).map((mention) => mention.referenceId));
          const nextIds = new Set(nextMentions.map((mention) => mention.referenceId));
          const retriedIds = new Set(update.transactions.flatMap((transaction) => (
            transaction.effects.filter((effect) => effect.is(retryMentionRemoval)).map((effect) => effect.value)
          )));
          for (const id of previousIds) {
            if (!nextIds.has(id) && !retriedIds.has(id)) callbacksRef.current.onRemoveReference?.(id);
          }
          callbacksRef.current.onChange(update.state.doc.toString(), nextMentions);
        }),
      ],
    });
    const view = new EditorView({ state, parent: host });
    const unsubscribeTypography = subscribeTypographyChanges(host.ownerDocument, () => view.requestMeasure());
    viewRef.current = view;
    view.dispatch({ effects: replaceMentionDecorations.of(referenceDecorations(value, mentions, references, t, onRetryReference)) });
    return () => {
      unsubscribeTypography();
      viewRef.current = null;
      view.destroy();
    };
  // The editor instance is deliberately stable; controlled changes are synced below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    viewRef.current?.requestMeasure();
  }, [appearanceRevision]);

  useEffect(() => {
    if (!focusRequest || disabled || focusRequest === lastFocusRequest.current) return;
    lastFocusRequest.current = focusRequest;
    viewRef.current?.focus();
  }, [disabled, focusRequest]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    const normalized = normalizeAgentPromptMentions(value, mentions);
    if (current === value && sameMentions(readMentions(view.state), normalized)) {
      view.dispatch({ effects: replaceMentionDecorations.of(referenceDecorations(value, normalized, references, t, onRetryReference)) });
      return;
    }
    view.dispatch({
      ...(current === value ? {} : { changes: { from: 0, to: current.length, insert: value } }),
      effects: replaceMentionDecorations.of(referenceDecorations(value, normalized, references, t, onRetryReference)),
    });
  }, [mentions, onRetryReference, references, t, value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: editableCompartmentRef.current.reconfigure(EditorView.editable.of(!disabled)) });
    view.contentDOM.setAttribute("aria-label", ariaLabel);
    view.contentDOM.setAttribute("aria-disabled", disabled ? "true" : "false");
  }, [ariaLabel, disabled]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: placeholderCompartmentRef.current.reconfigure(placeholderExtension(placeholder)) });
  }, [placeholder]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || disabled) return;
    const existing = new Set(readMentions(view.state).map((mention) => mention.referenceId));
    const insertions = references.filter((reference) => (
      !isAgentMediaReference(reference) && !existing.has(reference.id)
    ));
    if (insertions.length === 0) return;

    const position = view.state.selection.main.head;
    const document = view.state.doc.toString();
    const prefix = position > 0 && !/\s/.test(document[position - 1] ?? "") ? " " : "";
    let inserted = prefix;
    const added: AgentPromptReferenceMention[] = [];
    for (const [index, reference] of insertions.entries()) {
      if (index > 0) inserted += " ";
      const start = position + inserted.length;
      inserted += agentPromptMentionText(reference);
      added.push({ referenceId: reference.id, start, end: position + inserted.length });
    }
    inserted += position < document.length && !/\s/.test(document[position] ?? "") ? " " : "";
    const transaction = view.state.update({
      changes: { from: position, insert: inserted },
      selection: { anchor: position + inserted.length },
    });
    const mapped = readMentions(view.state).map((mention) => ({
      ...mention,
      start: transaction.changes.mapPos(mention.start, 1),
      end: transaction.changes.mapPos(mention.end, -1),
    }));
    view.dispatch({
      changes: { from: position, insert: inserted },
      selection: { anchor: position + inserted.length },
      effects: replaceMentionDecorations.of(referenceDecorations(
        transaction.state.doc.toString(),
        [...mapped, ...added].sort((left, right) => left.start - right.start),
        references,
        t,
        onRetryReference,
      )),
    });
    view.focus();
  }, [disabled, onRetryReference, references, t]);

  return <div ref={hostRef} className="desktop-agent-prompt-editor" dir="auto" />;
}

function referenceDecorations(
  prompt: string,
  mentions: readonly AgentPromptReferenceMention[],
  references: readonly AgentDraftReference[],
  t: MessageFormatter,
  onRetryReference?: (id: string) => void,
): AgentPromptReferenceDecoration[] {
  const byId = new Map(references.map((reference) => [reference.id, reference]));
  return normalizeAgentPromptMentions(prompt, mentions, new Set(byId.keys())).flatMap((mention) => {
    const reference = byId.get(mention.referenceId);
    if (!reference) return [];
    const identity = reference.kind === "workspace-entry" ? reference.relativePath : reference.displayName;
    const localizedError = reference.status === "error" ? localizedReferenceError(reference, t) : "";
    const rawError = reference.status === "error" ? reference.error?.message || "" : "";
    return [{
      ...mention,
      label: prompt.slice(mention.start, mention.end),
      title: [identity, localizedError, rawError !== localizedError ? rawError : ""].filter(Boolean).join("\n"),
      referenceKind: reference.kind,
      status: reference.status,
      errorLabel: localizedError,
      retryLabel: t("agent.reference.retry", { name: bidiIsolate(reference.displayName) }),
      removeLabel: t("agent.reference.remove", { name: bidiIsolate(reference.displayName) }),
      onRetry: onRetryReference,
    }];
  });
}

function preventEditorSelection(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}

function removeMentionFromEditor(view: EditorView, mention: AgentPromptReferenceMention, retry = false) {
  view.dispatch({
    changes: { from: mention.start, to: mention.end },
    selection: { anchor: mention.start },
    ...(retry ? { effects: retryMentionRemoval.of(mention.referenceId) } : {}),
  });
  view.focus();
}

function readMentions(state: EditorState) {
  const mentions: AgentPromptReferenceMention[] = [];
  state.field(mentionDecorations).between(0, state.doc.length, (start, end, decoration) => {
    const referenceId = decoration.spec.referenceId;
    if (typeof referenceId === "string") mentions.push({ referenceId, start, end });
  });
  return mentions;
}

function sameMentions(left: readonly AgentPromptReferenceMention[], right: readonly AgentPromptReferenceMention[]) {
  return left.length === right.length && left.every((mention, index) => (
    mention.referenceId === right[index]?.referenceId
    && mention.start === right[index]?.start
    && mention.end === right[index]?.end
  ));
}
