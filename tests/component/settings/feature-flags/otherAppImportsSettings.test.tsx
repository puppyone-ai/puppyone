/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { OtherAppImportsSettingsView } from "../../../../src/features/settings/main/OtherAppImportsSettingsView";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

it("lists all four import sources and opens the existing import flow", () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const onOpenImport = vi.fn();

  act(() => root?.render(withTestLocalization(
    <OtherAppImportsSettingsView onOpenImport={onOpenImport} />,
  )));

  for (const source of ["Notion", "Google Drive", "Airtable", "Obsidian"]) {
    expect(host.textContent).toContain(source);
  }
  const button = host.querySelector<HTMLButtonElement>("button");
  expect(button?.textContent).toBe("Import");
  act(() => button?.click());
  expect(onOpenImport).toHaveBeenCalledOnce();
});
