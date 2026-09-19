type SelectionAppearanceLease = { references: number; dispose: () => void };
const leases = new WeakMap<Document, SelectionAppearanceLease>();

/** Project focus only. Native DOM/controls continue to own selection ranges. */
export function retainTextSelectionAppearance(document: Document): () => void {
  const existing = leases.get(document);
  if (existing) {
    existing.references += 1;
    return releaseOnce(document, existing);
  }
  const window = document.defaultView;
  if (!window) return () => undefined;
  let owner: Element | null = null;
  let windowActive = document.hasFocus();
  const clearOwner = () => {
    owner?.removeAttribute("data-po-native-selection");
    owner = null;
  };
  const update = () => {
    document.documentElement.dataset.poWindowActive = String(windowActive);
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      clearOwner();
      return;
    }
    const ancestor = selection.getRangeAt(0).commonAncestorContainer;
    const nextOwner = ancestor.nodeType === 1 ? ancestor as Element : ancestor.parentElement;
    // Never mutate CodeMirror-managed content. Its adapter already knows the
    // actual input focus, including independently editable Widget descendants.
    if (nextOwner?.closest("[data-po-selection-renderer]")) {
      clearOwner();
      return;
    }
    if (nextOwner !== owner) {
      clearOwner();
      owner = nextOwner;
    }
    if (!owner) return;
    const focused = document.activeElement;
    const active = windowActive && (
      !focused || focused === document.body || focused === document.documentElement
      || focused.contains(owner)
    );
    owner.setAttribute("data-po-native-selection", active ? "active" : "inactive");
  };
  const onFocus = () => { windowActive = true; update(); };
  const onBlur = () => { windowActive = false; update(); };
  document.addEventListener("selectionchange", update);
  document.addEventListener("focusin", update);
  document.addEventListener("focusout", update);
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  update();
  const lease = {
    references: 1,
    dispose: () => {
      clearOwner();
      delete document.documentElement.dataset.poWindowActive;
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    },
  };
  leases.set(document, lease);
  return releaseOnce(document, lease);
}

function releaseOnce(document: Document, lease: SelectionAppearanceLease) {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--lease.references > 0) return;
    lease.dispose();
    leases.delete(document);
  };
}
