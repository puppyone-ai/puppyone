/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LocalizationProvider,
  useLocalization,
  type LocaleClient,
} from "@puppyone/localization/react";
import type { LocaleState } from "@puppyone/localization/core";

const englishState: LocaleState = {
  preference: "en",
  locale: "en",
  direction: "ltr",
  systemLanguages: ["en-US"],
};
const frenchState: LocaleState = {
  preference: "fr",
  locale: "fr",
  direction: "ltr",
  systemLanguages: ["en-US"],
};

afterEach(() => {
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
  delete document.documentElement.dataset.locale;
  delete document.documentElement.dataset.languagePreference;
  document.body.replaceChildren();
});

describe("LocalizationProvider document contract", () => {
  it("updates document locale attributes without remounting the application", async () => {
    const client: LocaleClient = {
      setLanguagePreference: vi.fn(async () => frenchState),
      onLocaleChanged: vi.fn(() => () => undefined),
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <LocalizationProvider
          initialState={englishState}
          initialCatalog={{ "common.messageUnavailable": "Unavailable" }}
          fallbackCatalog={{ "common.messageUnavailable": "Unavailable" }}
          loadCatalog={async () => ({
            catalog: { "common.messageUnavailable": "Indisponible" },
            fallbackCatalog: { "common.messageUnavailable": "Unavailable" },
          })}
          client={client}
        >
          <LanguageSwitch />
        </LocalizationProvider>,
      );
    });

    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");

    await act(async () => {
      host.querySelector("button")?.click();
      await Promise.resolve();
    });

    expect(document.documentElement.lang).toBe("fr");
    expect(document.documentElement.dir).toBe("ltr");
    expect(document.documentElement.dataset.locale).toBe("fr");
    expect(document.documentElement.dataset.languagePreference).toBe("fr");

    await act(async () => root.unmount());
  });
});

function LanguageSwitch() {
  const { setLanguagePreference } = useLocalization();
  return <button type="button" onClick={() => void setLanguagePreference("fr")}>switch</button>;
}
