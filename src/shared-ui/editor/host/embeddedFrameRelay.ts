/**
 * An editor that draws its document inside a frame scrolls and takes the
 * pointer where its host document cannot see: neither reaches the host as
 * scroll or pointer events. The editor relays both onto the frame element, so
 * a host treats the frame like any other scroller under its chrome.
 */
export const EMBEDDED_SCROLL_EVENT = "puppyone:embedded-scroll";
export const EMBEDDED_POINTER_EVENT = "puppyone:embedded-pointer";

/** How far the frame's document is scrolled from its top. */
export type EmbeddedScrollDetail = Readonly<{ top: number }>;

/** Where the pointer is, in the host document's client coordinates; null once it has left the frame. */
export type EmbeddedPointerDetail = Readonly<{ clientX: number; clientY: number }> | null;

export function relayEmbeddedScroll(frame: Element | null | undefined, top: number): void {
  frame?.dispatchEvent(new CustomEvent<EmbeddedScrollDetail>(EMBEDDED_SCROLL_EVENT, {
    bubbles: true,
    detail: { top },
  }));
}

/** `point` is in the frame's own client coordinates, as its document reports them. */
export function relayEmbeddedPointer(
  frame: Element | null | undefined,
  point: Readonly<{ x: number; y: number }> | null,
): void {
  if (!frame) return;
  const bounds = point ? frame.getBoundingClientRect() : null;
  frame.dispatchEvent(new CustomEvent<EmbeddedPointerDetail>(EMBEDDED_POINTER_EVENT, {
    bubbles: true,
    detail: point && bounds ? { clientX: bounds.left + point.x, clientY: bounds.top + point.y } : null,
  }));
}
