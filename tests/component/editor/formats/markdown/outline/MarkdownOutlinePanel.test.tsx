/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownOutlinePanel } from "../../../../../../src/shared-ui/editor/markdown/MarkdownOutlinePanel";

const snapshot = {
  headings: [
    { from: 0, level: 1, title: "A", plainTitle: "A" },
    { from: 100, level: 2, title: "B", plainTitle: "B" },
  ],
  activeIndex: 1,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("MarkdownOutlinePanel", () => {
  it("renders nothing for fewer than two headings", async () => {
    await act(async () => root.render(
      <MarkdownOutlinePanel
        snapshot={{ headings: snapshot.headings.slice(0, 1), activeIndex: 0 }}
        onJump={() => {}}
        label="目录"
      />,
    ));
    expect(host.childElementCount).toBe(0);
  });

  it("marks the active entry and jumps by index", async () => {
    const onJump = vi.fn();
    await act(async () => root.render(
      <MarkdownOutlinePanel snapshot={snapshot} onJump={onJump} label="目录" />,
    ));
    const panel = host.querySelector("nav.po-markdown-outline-panel");
    expect(panel?.getAttribute("aria-label")).toBe("目录");
    const buttons = [...host.querySelectorAll<HTMLButtonElement>(".po-markdown-outline-item")];
    expect(buttons.map((button) => button.textContent)).toEqual(["A", "B"]);
    expect(buttons[1].getAttribute("aria-current")).toBe("location");
    expect(buttons[0].getAttribute("aria-current")).toBeNull();
    await act(async () => buttons[1].click());
    expect(onJump).toHaveBeenCalledWith(1);
  });

  it("indents nested headings by relative level and caps the depth", async () => {
    await act(async () => root.render(
      <MarkdownOutlinePanel
        snapshot={{
          headings: [
            { from: 0, level: 2, title: "A", plainTitle: "A" },
            { from: 10, level: 3, title: "B", plainTitle: "B" },
            { from: 20, level: 6, title: "C", plainTitle: "C" },
          ],
          activeIndex: 0,
        }}
        onJump={() => {}}
        label="Outline"
      />,
    ));
    const indents = [...host.querySelectorAll<HTMLButtonElement>(".po-markdown-outline-item")]
      .map((button) => button.style.getPropertyValue("--po-markdown-outline-indent"));
    expect(indents).toEqual(["0px", "12px", "36px"]);
  });
});
