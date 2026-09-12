/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  SettingsSectionHeader,
  SettingsSubsection,
  SettingsValueRow,
} from "../../../../src/features/settings/components";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.documentElement.dir = "ltr";
  document.body.replaceChildren();
});

describe("Settings primitives", () => {
  it("keeps headings semantic and Arabic values direction-aware in RTL", () => {
    document.documentElement.dir = "rtl";
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() => {
      root?.render(
        <>
          <SettingsSectionHeader title="الإعدادات" detail="تفضيلات التطبيق على هذا الجهاز." />
          <SettingsSubsection title="اللغة">
            <SettingsValueRow label="لغة التطبيق" value="العربية" />
          </SettingsSubsection>
        </>,
      );
    });

    expect(host.querySelector("h2")?.textContent).toBe("الإعدادات");
    const subsection = host.querySelector("section.desktop-settings-subsection");
    const heading = subsection?.querySelector("h3");
    expect(heading?.textContent).toBe("اللغة");
    expect(subsection?.getAttribute("aria-labelledby")).toBe(heading?.id);
    expect(host.querySelector(".desktop-settings-value-text")?.getAttribute("dir")).toBe("auto");
    expect(host.querySelector(".desktop-settings-group")).toBeNull();
  });

  it("does not create an unnamed section landmark for an untitled flat group", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() => {
      root?.render(
        <SettingsSubsection>
          <SettingsValueRow label="Status" value="Ready" />
        </SettingsSubsection>,
      );
    });

    expect(host.querySelector("section")).toBeNull();
    expect(host.querySelector("div.desktop-settings-subsection")).not.toBeNull();
  });

  it("pins monospace technical values to LTR", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() => {
      root?.render(<SettingsValueRow label="Service" value="https://api.example.test/v1" monospace />);
    });

    expect(host.querySelector(".desktop-settings-value-text")?.getAttribute("dir")).toBe("ltr");
  });
});
