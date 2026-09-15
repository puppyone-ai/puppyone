import { createMessageFormatter } from "@puppyone/localization/core";
import { TestLocalizationProvider } from "@puppyone/localization/testing";
import { createElement, Fragment, type ReactElement, type ReactNode } from "react";
import type { Root } from "react-dom/client";
import englishCatalog from "../../../src/localization/catalog-loaders/en";

/** Mount product components with the same complete English catalog used by the app. */
export function withTestLocalization(element: ReactNode): ReactElement {
  return createElement(TestLocalizationProvider, { messages: englishCatalog, children: element });
}

/** Render through the application localization boundary without duplicating provider setup. */
export function renderWithTestLocalization(root: Root | null, node: ReactNode): void {
  root?.render(withTestLocalization(createElement(Fragment, null, node)));
}

/** Ignore Unicode direction-isolation controls when asserting visible copy. */
export function stripBidiIsolation(value: string | null | undefined): string {
  return (value ?? "").replace(/[\u2066-\u2069]/g, "");
}

export const testT = createMessageFormatter({
  locale: "en",
  catalog: englishCatalog,
  fallbackCatalog: englishCatalog,
});
