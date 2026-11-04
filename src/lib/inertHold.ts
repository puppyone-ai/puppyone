const holds = new WeakMap<Element, number>();

/**
 * Makes an element inert until the returned function is called. Several owners can
 * hold one element, and it wakes when the last lets go. An element already inert by
 * its own markup is left to that markup.
 */
export function holdInert(element: Element) {
  const held = holds.get(element);
  if (held === undefined && element.hasAttribute("inert")) return () => undefined;
  holds.set(element, (held ?? 0) + 1);
  element.setAttribute("inert", "");
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (holds.get(element) ?? 1) - 1;
    if (remaining > 0) {
      holds.set(element, remaining);
      return;
    }
    holds.delete(element);
    element.removeAttribute("inert");
  };
}

/**
 * Everything beside this element's branch of the document, which is what a modal
 * outside the top layer has to do by hand. The overlay root is passed over: menus
 * and tooltips raised by the modal itself open there. `spared` leaves out anything
 * else that has to stay alive.
 */
export function holdInertAround(element: Element, spared: (sibling: Element) => boolean = () => false) {
  const releases: (() => void)[] = [];
  for (let node = element; node !== document.body && node.parentElement; node = node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling === node || sibling.hasAttribute("data-po-overlay-root") || spared(sibling)) continue;
      releases.push(holdInert(sibling));
    }
  }
  return () => releases.forEach((release) => release());
}
