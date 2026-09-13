import { TestLocalizationProvider } from "@puppyone/localization/testing";
import { createElement, Fragment, type ReactElement, type ReactNode } from "react";
import englishCatalog from "../../../src/localization/catalog-loaders/en";

/**
 * Mount renderer benchmarks through the same complete localization boundary as
 * the product. Benchmarks should measure real component work, not error paths
 * caused by an incomplete test harness.
 */
export function withBenchmarkLocalization(node: ReactNode): ReactElement {
  return createElement(
    TestLocalizationProvider,
    { messages: englishCatalog, children: createElement(Fragment, null, node) },
  );
}
