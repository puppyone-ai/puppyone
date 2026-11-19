/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  EMBEDDED_POINTER_EVENT,
  EMBEDDED_SCROLL_EVENT,
  relayEmbeddedPointer,
  relayEmbeddedScroll,
  type EmbeddedPointerDetail,
  type EmbeddedScrollDetail,
} from "../../../../src/shared-ui/editor/host/embeddedFrameRelay";

afterEach(() => {
  document.body.replaceChildren();
});

/** A frame 40 px down and 10 px in, inside a host that records what reaches it. */
function frameInHost() {
  const host = document.createElement("div");
  const frame = document.createElement("iframe");
  frame.getBoundingClientRect = () => ({ left: 10, top: 40, right: 810, bottom: 640, width: 800, height: 600 } as DOMRect);
  host.append(frame);
  document.body.append(host);
  const received: Array<[string, unknown]> = [];
  for (const type of [EMBEDDED_SCROLL_EVENT, EMBEDDED_POINTER_EVENT]) {
    host.addEventListener(type, (event) => received.push([type, (event as CustomEvent).detail]));
  }
  return { frame, received };
}

describe("embedded frame relay", () => {
  it("tells the host how far the frame's page is scrolled", () => {
    const { frame, received } = frameInHost();
    relayEmbeddedScroll(frame, 430);
    expect(received).toEqual([[EMBEDDED_SCROLL_EVENT, { top: 430 } satisfies EmbeddedScrollDetail]]);
  });

  it("puts the pointer in the host's coordinates, and says when it leaves", () => {
    const { frame, received } = frameInHost();
    relayEmbeddedPointer(frame, { x: 100, y: 60 });
    relayEmbeddedPointer(frame, null);
    expect(received).toEqual([
      [EMBEDDED_POINTER_EVENT, { clientX: 110, clientY: 100 } satisfies EmbeddedPointerDetail],
      [EMBEDDED_POINTER_EVENT, null],
    ]);
  });

  it("does nothing without a frame", () => {
    expect(() => {
      relayEmbeddedScroll(null, 10);
      relayEmbeddedPointer(undefined, { x: 1, y: 1 });
    }).not.toThrow();
  });
});
