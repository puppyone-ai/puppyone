const RESTING_ATTRIBUTE = "data-pointer-resting";
const RELEASING_EVENTS = ["pointermove", "pointerdown"] as const;

/**
 * Removing a surface re-evaluates hover under a pointer that never moved, so whatever
 * it uncovers would light up and offer its tooltip unasked. Until the pointer is used
 * again, the root carries this attribute for surfaces that want to wait for it; such
 * a surface also ignores the second half of a double click on the closing control.
 */
export function holdHoverUntilPointerUse() {
  const root = document.documentElement;
  if (root.hasAttribute(RESTING_ATTRIBUTE)) return;
  root.setAttribute(RESTING_ATTRIBUTE, "");
  const release = () => {
    root.removeAttribute(RESTING_ATTRIBUTE);
    for (const type of RELEASING_EVENTS) window.removeEventListener(type, release, true);
  };
  for (const type of RELEASING_EVENTS) window.addEventListener(type, release, true);
}
