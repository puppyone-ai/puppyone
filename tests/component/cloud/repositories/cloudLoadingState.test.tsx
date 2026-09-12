/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { CloudWorkspaceLoadingState } from "../../../../src/features/cloud/components/shared";
import { renderWithTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("Cloud loading state", () => {
  it("uses the neutral loader tone", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => renderWithTestLocalization(root,
      <CloudWorkspaceLoadingState label="Loading project" />,
    ));

    const point = container.querySelector<HTMLElement>("[data-pulse-grid-point]");
    expect(point?.style.background).toBe("var(--po-text-subtle)");
    expect(point?.style.background).not.toBe("var(--po-accent)");
  });

  it("centers against the full Cloud main surface", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/features/cloud/styles/sidebar-shell.css"),
      "utf8",
    );
    const main = readCssBlock(css, ".desktop-cloud-main-view");
    const loading = readCssBlock(css, ".desktop-cloud-loading-state");

    expect(main).toContain("position: relative;");
    expect(loading).toContain("position: absolute;");
    expect(loading).toContain("inset: 0;");
    expect(loading).toContain("width: 100%;");
    expect(loading).toContain("height: 100%;");
    expect(loading).toContain("place-items: center;");
  });
});

function readCssBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return "";
  const end = css.indexOf("}", start);
  return end < 0 ? css.slice(start) : css.slice(start, end + 1);
}
