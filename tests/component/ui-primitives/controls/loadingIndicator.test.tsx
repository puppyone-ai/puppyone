/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  InlineLoading,
  LOADING_MARK_DITHER_LIGHT,
  LoadingMark,
  LoadingPlaceholderStyleProvider,
  type LoadingPlaceholderStyle,
} from "@puppyone/shared-ui";
import { ORDERED_DITHER_LIGHT } from "../../../../packages/shared-ui/src/primitives/orderedDitherField";
import { InlineLoading as DesktopInlineLoading, PageLoading } from "../../../../src/components/loading";
import { SourceControlDots } from "../../../../src/features/source-control/sidebar/GitSidebarPrimitives";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function render(node: ReactNode, style: LoadingPlaceholderStyle = "rounded") {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const paint = (next: LoadingPlaceholderStyle) => act(() => root!.render(withTestLocalization(
    <LoadingPlaceholderStyleProvider style={next}>{node}</LoadingPlaceholderStyleProvider>,
  )));
  paint(style);
  return { host, restyle: paint };
}

const mark = (host: Element) => host.querySelector<HTMLElement>("[data-puppy-loader]")!;
const units = (host: Element) => [...mark(host).querySelectorAll<HTMLElement>("[data-loading-mark-unit]")];

describe("LoadingMark", () => {
  it("relays a capsule along three dots inside a strip in the rounded style", () => {
    const { host } = render(<LoadingMark ariaHidden />, "rounded");
    expect(mark(host).dataset.puppyLoader).toBe("mark");
    expect(mark(host).dataset.loadingStyle).toBe("rounded");
    expect(mark(host).dataset.loadingLayout).toBe("inline");
    expect(mark(host).dataset.loadingFigure).toBe("relay");
    expect(units(host)).toHaveLength(3);
    expect(mark(host).querySelectorAll("[data-loading-mark-baton]")).toHaveLength(1);
    expect(units(host).some((unit) => unit.hasAttribute("data-placeholder-shape"))).toBe(false);
    expect(mark(host).querySelector("canvas")).toBeNull();
  });

  it("gathers three dots in a region in the rounded style", () => {
    const { host } = render(<LoadingMark layout="area" size="md" ariaHidden />, "rounded");
    expect(mark(host).dataset.loadingLayout).toBe("area");
    expect(mark(host).dataset.loadingFigure).toBe("gather");
    expect(units(host)).toHaveLength(3);
    expect(mark(host).querySelector("[data-loading-mark-baton]")).toBeNull();
    expect(mark(host).style.getPropertyValue("--po-loading-mark-box")).toBe("24px");
  });

  it("draws three pixel blocks on the placeholder dither layer in the dither loading style", () => {
    const { host } = render(<LoadingMark ariaHidden />, "dither");
    expect(mark(host).dataset.loadingStyle).toBe("dither");
    expect(mark(host).dataset.loadingFigure).toBe("blocks");
    expect(mark(host).classList.contains("po-placeholder-surface")).toBe(true);
    expect(units(host).every((unit) => unit.hasAttribute("data-placeholder-shape"))).toBe(true);
    expect(mark(host).querySelector("canvas.po-dither-canvas")).not.toBeNull();
  });

  it("switches material as soon as the Appearance loading style changes", () => {
    const { host, restyle } = render(<LoadingMark ariaHidden />, "rounded");
    restyle("dither");
    expect(mark(host).dataset.loadingStyle).toBe("dither");
    restyle("rounded");
    expect(mark(host).dataset.loadingStyle).toBe("rounded");
    expect(mark(host).querySelector("canvas")).toBeNull();
  });

  it("lets a preview pin its own style regardless of the Appearance style", () => {
    const { host } = render(<LoadingMark loadingStyle="dither" ariaHidden />, "rounded");
    expect(mark(host).dataset.loadingStyle).toBe("dither");
  });

  it.each([
    ["rounded", "xs", "3px", "2px"],
    ["rounded", "sm", "4px", "3px"],
    ["rounded", "md", "5px", "4px"],
    ["dither", "xs", "4px", "2px"],
    ["dither", "sm", "5px", "2px"],
    ["dither", "md", "6px", "3px"],
  ] as const)("sizes %s %s units at %s with a %s gap", (style, size, unit, gap) => {
    const { host } = render(<LoadingMark size={size} ariaHidden />, style);
    expect(mark(host).style.getPropertyValue("--po-loading-mark-unit")).toBe(unit);
    expect(mark(host).style.getPropertyValue("--po-loading-mark-gap")).toBe(gap);
  });

  it("inks the mark in its tone", () => {
    const { host } = render(<><LoadingMark tone="info" ariaHidden /><LoadingMark tone="danger" ariaHidden /></>);
    const [info, danger] = [...host.querySelectorAll<HTMLElement>("[data-puppy-loader]")];
    expect(info.style.getPropertyValue("--po-loading-mark-ink")).toBe("var(--po-info, var(--po-accent))");
    expect(danger.style.getPropertyValue("--po-loading-mark-ink")).toBe("var(--po-danger)");
  });

  it("announces loading unless the host already does", () => {
    const { host } = render(<><LoadingMark ariaLabel="Opening project" /><LoadingMark ariaHidden /></>);
    const [announced, hidden] = [...host.querySelectorAll<HTMLElement>("[data-puppy-loader]")];
    expect(announced.getAttribute("role")).toBe("status");
    expect(announced.getAttribute("aria-label")).toBe("Opening project");
    expect(hidden.getAttribute("role")).toBeNull();
    expect(hidden.getAttribute("aria-hidden")).toBe("true");
  });

  it("scales the placeholder light down to a narrow, fast band for the mark", () => {
    expect(LOADING_MARK_DITHER_LIGHT.width).toBeLessThan(ORDERED_DITHER_LIGHT.width);
    expect(LOADING_MARK_DITHER_LIGHT.period).toBeLessThan(ORDERED_DITHER_LIGHT.period);
    expect(LOADING_MARK_DITHER_LIGHT.halo).toBe(0);
    expect(LOADING_MARK_DITHER_LIGHT.base + LOADING_MARK_DITHER_LIGHT.peak).toBeGreaterThanOrEqual(1);
  });
});

describe("loading surfaces share the one mark", () => {
  it.each([["xs", "12px"], ["sm", "16px"], ["md", "24px"]] as const)("sizes the %s gather from a %s box", (size, box) => {
    const { host } = render(<LoadingMark layout="area" size={size} ariaHidden />);
    expect(mark(host).style.getPropertyValue("--po-loading-mark-box")).toBe(box);
  });

  it("gathers on a loading page and relays beside loading text", () => {
    const { host } = render(<><PageLoading label="Loading" variant="fill" /><DesktopInlineLoading label="Loading" />
      <InlineLoading label="Loading" /><SourceControlDots /></>, "rounded");
    expect([...host.querySelectorAll<HTMLElement>("[data-puppy-loader]")].map((node) => node.dataset.loadingFigure))
      .toEqual(["gather", "relay", "relay", "relay"]);
  });

  it.each(["rounded", "dither"] as const)("draws page, inline and Git loading with the %s mark", (style) => {
    const { host } = render(<>
      <PageLoading label="Loading" variant="fill" />
      <DesktopInlineLoading label="Loading" />
      <InlineLoading label="Loading" />
      <SourceControlDots />
    </>, style);
    const marks = [...host.querySelectorAll<HTMLElement>("[data-puppy-loader]")];
    expect(marks).toHaveLength(4);
    expect(marks.every((node) => node.dataset.puppyLoader === "mark" && node.dataset.loadingStyle === style)).toBe(true);
    expect(marks[3].classList.contains("desktop-git-loading-dots")).toBe(true);
    expect(marks[3].style.getPropertyValue("--po-loading-mark-ink")).toBe("var(--po-info, var(--po-accent))");
  });
});
