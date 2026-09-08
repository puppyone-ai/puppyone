import { describe, expect, it, vi } from "vitest";
import { createMessageFormatter, type LocaleCatalog } from "@puppyone/localization/core";
import { presentAgentError } from "../src/features/desktop-agent/ui/agentErrorPresentation";

const catalogs = import.meta.glob<LocaleCatalog>("../src/localization/catalog-loaders/*.ts", { eager: true, import: "default" });
describe("closed Agent session presentation", () => {
  it.each(Object.entries(catalogs))("renders an ended session without missing-message fallback in %s", (_path, catalog) => {
    const onDiagnostic = vi.fn();
    const t = createMessageFormatter({ locale: "en", catalog, fallbackCatalog: catalog, onDiagnostic });
    const result = presentAgentError({ code: "session-ended" }, t);
    expect(result?.summary).toBeTruthy();
    expect(onDiagnostic).not.toHaveBeenCalled();
  });
});
