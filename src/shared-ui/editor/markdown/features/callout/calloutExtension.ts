import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { markdownLivePreviewFocusEffect } from "../../core/state/livePreviewFocus";
import { createCalloutIcon } from "./calloutIcons";
import { getMarkdownCallouts, type MarkdownCallout } from "./calloutModel";

/** Fold state is view state: reading a callout must not rewrite the document. */
const calloutFoldEffect = StateEffect.define<Readonly<{ at: number; folded: boolean }>>();

const calloutFoldField = StateField.define<ReadonlyMap<number, boolean>>({
  create: () => new Map(),
  update(value, transaction) {
    let next = new Map<number, boolean>();
    for (const [position, folded] of value) next.set(transaction.changes.mapPos(position), folded);
    for (const effect of transaction.effects) {
      if (effect.is(calloutFoldEffect)) {
        next = new Map(next);
        next.set(effect.value.at, effect.value.folded);
      }
    }
    return next;
  },
});

/** An unfocused pane has no caret to reveal for, even when its selection sits here. */
const calloutFocusField = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(markdownLivePreviewFocusEffect)) return effect.value;
    }
    return value;
  },
});

class CalloutHeaderWidget extends WidgetType {
  constructor(
    private readonly callout: MarkdownCallout,
    private readonly folded: boolean,
  ) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return (
      widget instanceof CalloutHeaderWidget &&
      widget.folded === this.folded &&
      widget.callout.appearance === this.callout.appearance &&
      widget.callout.defaultTitle === this.callout.defaultTitle &&
      widget.callout.hasTitle === this.callout.hasTitle &&
      widget.callout.fold === this.callout.fold &&
      widget.callout.markerFrom === this.callout.markerFrom
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const { callout, folded } = this;
    const header = document.createElement("span");
    header.className = "cm-md-callout-header";

    const icon = document.createElement("span");
    icon.className = "cm-md-callout-icon";
    icon.appendChild(createCalloutIcon(callout.appearance));
    header.appendChild(icon);

    if (!callout.hasTitle) header.append(document.createTextNode(callout.defaultTitle));

    if (callout.fold) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "cm-md-callout-fold";
      toggle.classList.toggle("is-folded", folded);
      toggle.setAttribute("aria-expanded", String(!folded));
      toggle.setAttribute("aria-label", callout.defaultTitle);
      toggle.appendChild(createCalloutIcon("chevron"));
      toggle.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        view.dispatch({ effects: calloutFoldEffect.of({ at: callout.markerFrom, folded: !folded }) });
      });
      header.appendChild(toggle);
    }
    return header;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function buildCalloutDecorations(state: EditorState): DecorationSet {
  const folds = state.field(calloutFoldField);
  const ranges: Range<Decoration>[] = [];
  const caretLine = state.field(calloutFocusField) && !state.readOnly
    ? state.doc.lineAt(state.selection.main.head).number
    : null;

  for (const callout of getMarkdownCallouts(state)) {
    const folded = callout.fold !== null
      && (folds.get(callout.markerFrom) ?? callout.fold === "folded");
    const lastVisible = folded ? callout.firstLine : callout.lastLine;
    for (let number = callout.firstLine; number <= lastVisible; number += 1) {
      const classes = [
        "cm-md-callout",
        `cm-md-callout-${callout.appearance}`,
        number === callout.firstLine ? "is-title" : "",
        number === lastVisible ? "is-last" : "",
      ].filter(Boolean).join(" ");
      ranges.push(Decoration.line({ class: classes }).range(state.doc.line(number).from));
    }

    if (caretLine !== callout.firstLine) {
      ranges.push(Decoration.replace({
        widget: new CalloutHeaderWidget(callout, folded),
        inclusive: false,
      }).range(callout.markerFrom, callout.markerTo));
    }

    if (folded && callout.lastLine > callout.firstLine) {
      ranges.push(Decoration.replace({ block: true }).range(
        state.doc.line(callout.firstLine + 1).from,
        state.doc.line(callout.lastLine).to,
      ));
    }
  }

  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges.sort((left, right) => left.from - right.from || left.value.startSide - right.value.startSide)) {
    builder.add(range.from, range.to, range.value);
  }
  return builder.finish();
}

const calloutDecorationField = StateField.define<DecorationSet>({
  create: buildCalloutDecorations,
  update(value, transaction) {
    const refold = transaction.effects.some((effect) => (
      effect.is(calloutFoldEffect) || effect.is(markdownLivePreviewFocusEffect)
    ));
    return transaction.docChanged
      || transaction.selection
      || refold
      || syntaxTree(transaction.state) !== syntaxTree(transaction.startState)
      ? buildCalloutDecorations(transaction.state)
      : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const markdownCalloutExtension: Extension = [calloutFoldField, calloutFocusField, calloutDecorationField];
