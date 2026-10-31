import { StateEffect, StateField } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";

const pointerSelectionEffect = StateEffect.define<boolean>();

export const markdownPointerSelectionField = StateField.define<boolean>({
  create: () => false,
  update(active, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(pointerSelectionEffect)) active = effect.value;
    }
    // Typing/drop ends CodeMirror's mouse selection too. Do not delay the
    // projection of committed edits behind an abandoned pointer gesture.
    return transaction.docChanged ? false : active;
  },
});

/** Keep source reveal geometry fixed from mouse hit testing through release. */
export const markdownPointerSelectionExtension = [
  markdownPointerSelectionField,
  ViewPlugin.define((view) => {
    let releaseTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (releaseTimer !== null || !view.state.field(markdownPointerSelectionField)) return;
      // CodeMirror finishes selection on document.mouseup. Link activation
      // also runs during the same event. Reconcile only after both finish.
      // A timer crosses the whole native event dispatch; a microtask from a
      // capture listener can run before subsequent target/bubble listeners.
      releaseTimer = setTimeout(() => {
        releaseTimer = null;
        if (!view.state.field(markdownPointerSelectionField)) return;
        view.dispatch({ effects: pointerSelectionEffect.of(false) });
      }, 0);
    };
    const onMove = (event: MouseEvent) => {
      if ((event.buttons & 1) === 0) finish();
    };
    const doc = view.dom.ownerDocument;
    const win = doc.defaultView;
    doc.addEventListener("mouseup", finish, true);
    doc.addEventListener("mousemove", onMove);
    doc.addEventListener("pointercancel", finish);
    win?.addEventListener("blur", finish);
    return {
      begin(event: MouseEvent) {
        if (event.button !== 0 || view.composing) return;
        if (releaseTimer !== null) clearTimeout(releaseTimer);
        releaseTimer = null;
        view.dispatch({ effects: pointerSelectionEffect.of(true) });
      },
      finish,
      destroy() {
        if (releaseTimer !== null) clearTimeout(releaseTimer);
        doc.removeEventListener("mouseup", finish, true);
        doc.removeEventListener("mousemove", onMove);
        doc.removeEventListener("pointercancel", finish);
        win?.removeEventListener("blur", finish);
      },
    };
  }, {
    eventObservers: {
      mousedown(event) { this.begin(event); },
      blur() { this.finish(); },
      dragstart() { this.finish(); },
      keydown() { this.finish(); },
    },
  }),
];
