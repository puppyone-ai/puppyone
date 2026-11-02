/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { InlineLoading, PageLoading } from "../../../../src/components/loading";
import { renderWithTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function names(content: React.ReactNode) {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => renderWithTestLocalization(root!, content));
  return [...document.querySelectorAll("[role='status']")].map((status) => status.getAttribute("aria-label"));
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("what a loading mark is called", () => {
  it("is announced once, by what its caller says", () => {
    expect(names(<InlineLoading label="Saving" />)).toEqual(["Saving"]);
  });

  it("prefers the name it is given over its words", () => {
    expect(names(<InlineLoading label="Saving" ariaLabel="Saving the project" />)).toEqual(["Saving the project"]);
  });

  it("falls back to the mark's localized name when an inline mark has no words", () => {
    expect(names(<InlineLoading label={null} />)).toEqual(["Loading…"]);
  });

  it("falls back to the mark's localized name when a page mark has no words", () => {
    expect(names(<PageLoading label={null} variant="fill" />)).toEqual(["Loading…"]);
  });
});
