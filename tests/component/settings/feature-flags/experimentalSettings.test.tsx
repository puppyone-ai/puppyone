/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExperimentalSettingsView } from "../../../../src/features/settings/main/ExperimentalSettingsView";
import { DEFAULT_EXPERIMENTAL_SETTINGS } from "../../../../src/preferences";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("Experimental settings", () => {
  it.each([
    ["Notion import", "enableNotionImport"],
    ["Google Drive import", "enableGoogleDriveImport"],
    ["Airtable import", "enableAirtableImport"],
    ["Obsidian import", "enableObsidianImport"],
  ] as const)("offers an off-by-default %s source", (label, settingKey) => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() => root?.render(withTestLocalization(
      <ExperimentalSettingsView
        settings={DEFAULT_EXPERIMENTAL_SETTINGS}
        assetLibraryHomeAvailable={false}
        onChange={onChange}
      />,
    )));

    const toggle = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    expect(toggle?.checked).toBe(false);
    act(() => toggle?.click());
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_EXPERIMENTAL_SETTINGS,
      [settingKey]: true,
    });
  });

  it("offers an off-by-default Built-in Agent opt-in", () => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() => root?.render(withTestLocalization(
      <ExperimentalSettingsView
        settings={DEFAULT_EXPERIMENTAL_SETTINGS}
        assetLibraryHomeAvailable={false}
        onChange={onChange}
      />,
    )));

    const toggle = host.querySelector<HTMLInputElement>('input[aria-label="Built-in Agent"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.checked).toBe(false);

    act(() => toggle?.click());
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_EXPERIMENTAL_SETTINGS,
      enableBuiltInAgent: true,
    });
  });

  it("offers an off-by-default cross-Project switcher rail", () => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() => root?.render(withTestLocalization(
      <ExperimentalSettingsView
        settings={DEFAULT_EXPERIMENTAL_SETTINGS}
        assetLibraryHomeAvailable={false}
        onChange={onChange}
      />,
    )));

    const toggle = host.querySelector<HTMLInputElement>(
      'input[aria-label="Project switcher rail"]',
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.checked).toBe(false);
    expect(host.querySelector('input[aria-label="Agent Chat"]')).toBeNull();

    act(() => toggle?.click());
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_EXPERIMENTAL_SETTINGS,
      enableProjectSwitcherRail: true,
    });
  });

  it("offers an off-by-default multi-project Workspace opt-in", () => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() => root?.render(withTestLocalization(
      <ExperimentalSettingsView
        settings={DEFAULT_EXPERIMENTAL_SETTINGS}
        assetLibraryHomeAvailable={false}
        onChange={onChange}
      />,
    )));

    const toggle = host.querySelector<HTMLInputElement>(
      'input[aria-label="Multi-project workspaces"]',
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.checked).toBe(false);

    act(() => toggle?.click());
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_EXPERIMENTAL_SETTINGS,
      enableMultiRootWorkspaces: true,
    });
  });

  it("offers an off-by-default first-project starting-point opt-in", () => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() => root?.render(withTestLocalization(
      <ExperimentalSettingsView
        settings={DEFAULT_EXPERIMENTAL_SETTINGS}
        assetLibraryHomeAvailable={false}
        onChange={onChange}
      />,
    )));

    const toggle = host.querySelector<HTMLInputElement>(
      'input[aria-label="First project starting point"]',
    );
    expect(toggle).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("offers an off-by-default Automation opt-in", () => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() => root?.render(withTestLocalization(
      <ExperimentalSettingsView
        settings={DEFAULT_EXPERIMENTAL_SETTINGS}
        assetLibraryHomeAvailable={false}
        onChange={onChange}
      />,
    )));

    const toggle = host.querySelector<HTMLInputElement>('input[aria-label="Automation"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.checked).toBe(false);

    act(() => toggle?.click());
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_EXPERIMENTAL_SETTINGS,
      enableCloudAutomation: true,
    });
  });
});
