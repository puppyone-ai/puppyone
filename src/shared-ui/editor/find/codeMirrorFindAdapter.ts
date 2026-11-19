import { SearchQuery } from "@codemirror/search";
import {
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  type DecorationSet,
} from "@codemirror/view";
import type {
  EditorFindAdapter,
  EditorFindDirection,
  EditorFindResult,
} from "./editorFind";

type TextMatch = Readonly<{ from: number; to: number }>;

const setFindDecorations = StateEffect.define<{
  current: number;
  matches: readonly TextMatch[];
}>();

const findDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let nextDecorations = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setFindDecorations)) continue;
      const ranges = effect.value.matches.map((match, index) => (
        Decoration.mark({
          class: index === effect.value.current
            ? "cm-editor-find-match cm-editor-find-match--current"
            : "cm-editor-find-match",
        }).range(match.from, match.to)
      ));
      nextDecorations = Decoration.set(ranges, true);
    }
    return nextDecorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export class CodeMirrorFindAdapter implements EditorFindAdapter {
  readonly extension: Extension;
  private view: EditorView | null = null;
  private query = "";
  private matches: readonly TextMatch[] = [];
  private current = -1;
  private listeners = new Set<(result: EditorFindResult) => void>();

  constructor() {
    this.extension = [
      findDecorations,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && this.query) this.refresh(false);
      }),
    ];
  }

  attach(view: EditorView) {
    this.view = view;
  }

  dispose() {
    this.view = null;
    this.matches = [];
    this.current = -1;
    this.listeners.clear();
  }

  setQuery(query: string): EditorFindResult {
    this.query = query;
    return this.refresh(true);
  }

  move(direction: EditorFindDirection): EditorFindResult {
    if (!this.view || this.matches.length === 0) return this.snapshot();
    this.current = direction === "next"
      ? (this.current + 1) % this.matches.length
      : (this.current - 1 + this.matches.length) % this.matches.length;
    this.revealCurrent();
    return this.publish();
  }

  clear() {
    this.query = "";
    this.matches = [];
    this.current = -1;
    this.applyDecorations();
  }

  focusEditor() {
    this.view?.focus();
  }

  subscribe(listener: (result: EditorFindResult) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private refresh(selectNearest: boolean): EditorFindResult {
    const view = this.view;
    if (!view || !this.query) {
      this.matches = [];
      this.current = -1;
      this.applyDecorations();
      return this.publish();
    }

    const query = new SearchQuery({
      search: this.query,
      caseSensitive: false,
      literal: true,
    });
    const nextMatches: TextMatch[] = [];
    const cursor = query.getCursor(view.state);
    for (let match = cursor.next(); !match.done; match = cursor.next()) {
      nextMatches.push(match.value);
    }
    this.matches = nextMatches;
    if (this.matches.length === 0) {
      this.current = -1;
    } else if (selectNearest || this.current < 0 || this.current >= this.matches.length) {
      const selectionPosition = view.state.selection.main.from;
      const nearest = this.matches.findIndex((match) => match.from >= selectionPosition);
      this.current = nearest >= 0 ? nearest : 0;
    }
    this.revealCurrent();
    return this.publish();
  }

  private revealCurrent() {
    const view = this.view;
    const match = this.matches[this.current];
    if (!view || !match) {
      this.applyDecorations();
      return;
    }
    view.dispatch({
      selection: { anchor: match.from, head: match.to },
      effects: [
        setFindDecorations.of({ current: this.current, matches: this.matches }),
        EditorView.scrollIntoView(match.from, { y: "center" }),
      ],
    });
  }

  private applyDecorations() {
    this.view?.dispatch({
      effects: setFindDecorations.of({ current: this.current, matches: this.matches }),
    });
  }

  private snapshot(): EditorFindResult {
    return {
      current: this.current >= 0 ? this.current + 1 : 0,
      total: this.matches.length,
    };
  }

  private publish(): EditorFindResult {
    const result = this.snapshot();
    for (const listener of this.listeners) listener(result);
    return result;
  }
}
