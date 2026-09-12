/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LocalizationProvider,
  type LocaleClient,
} from "@puppyone/localization/react";
import type { LocaleState } from "@puppyone/localization/core";
import { LanguageSettingRow } from "../../../../src/features/settings/LanguageSetting";
import englishCatalog from "../../../../src/localization/catalog-loaders/en";
import simplifiedChineseCatalog from "../../../../src/localization/catalog-loaders/zh-Hans";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const englishState: LocaleState = {
  preference: "system",
  locale: "en",
  direction: "ltr",
  systemLanguages: ["en-US"],
};

const germanState: LocaleState = {
  preference: "de",
  locale: "de",
  direction: "ltr",
  systemLanguages: ["en-US"],
};

const simplifiedChineseState: LocaleState = {
  preference: "zh-Hans",
  locale: "zh-Hans",
  direction: "ltr",
  systemLanguages: ["en-US"],
};

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
  delete document.documentElement.dataset.locale;
  delete document.documentElement.dataset.languagePreference;
  document.body.replaceChildren();
});

describe("LanguageSettingRow", () => {
  it("labels Follow System with the resolved system language instead of the current app language", async () => {
    const setLanguagePreference = vi.fn(async () => englishState);
    const client: LocaleClient = {
      setLanguagePreference,
      onLocaleChanged: vi.fn(() => () => undefined),
    };
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <LocalizationProvider
          initialState={simplifiedChineseState}
          initialCatalog={simplifiedChineseCatalog}
          fallbackCatalog={englishCatalog}
          loadCatalog={async () => ({
            catalog: englishCatalog,
            fallbackCatalog: englishCatalog,
          })}
          client={client}
        >
          <LanguageSettingRow />
        </LocalizationProvider>,
      );
    });

    const select = host.querySelector<HTMLSelectElement>(".desktop-language-setting-select");
    const systemOption = select?.querySelector<HTMLOptionElement>('option[value="system"]');
    expect(select?.value).toBe("zh-Hans");
    expect(systemOption?.textContent).toBe("跟随系统 — English");

    await act(async () => {
      if (!select) throw new Error("Language select was not rendered.");
      select.value = "system";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    expect(setLanguagePreference).toHaveBeenCalledWith("system");
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dataset.languagePreference).toBe("system");
  });

  it("renders the app-language control and applies selection immediately without an action button", async () => {
    const setLanguagePreference = vi.fn(async () => germanState);
    const client: LocaleClient = {
      setLanguagePreference,
      onLocaleChanged: vi.fn(() => () => undefined),
    };
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <LocalizationProvider
          initialState={englishState}
          initialCatalog={englishCatalog}
          fallbackCatalog={englishCatalog}
          loadCatalog={async () => ({
            catalog: englishCatalog,
            fallbackCatalog: englishCatalog,
          })}
          client={client}
        >
          <LanguageSettingRow />
        </LocalizationProvider>,
      );
    });

    const select = host.querySelector<HTMLSelectElement>(".desktop-language-setting-select");
    expect(host.querySelector(".desktop-settings-section-header")).toBeNull();
    expect(select?.getAttribute("aria-label")).toBe("App language");
    expect(select?.value).toBe("system");
    expect(host.querySelector("button")).toBeNull();

    await act(async () => {
      if (!select) throw new Error("Language select was not rendered.");
      select.value = "de";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    expect(setLanguagePreference).toHaveBeenCalledTimes(1);
    expect(setLanguagePreference).toHaveBeenCalledWith("de");
    expect(document.documentElement.lang).toBe("de");
    expect(document.documentElement.dataset.languagePreference).toBe("de");
  });
});
