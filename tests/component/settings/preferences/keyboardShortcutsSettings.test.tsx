/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { KeyboardShortcutsSettingsView } from "../../../../src/features/settings/main/KeyboardShortcutsSettingsView";
import { resolveSettingsSidebarGroups } from "../../../../src/features/settings/sidebar/settingsSidebarModel";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); });
function render() {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root!.render(withTestLocalization(<KeyboardShortcutsSettingsView initialPlatform="mac" />)));
  return host;
}
function search(host: HTMLElement, text: string) {
  const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
describe("Keyboard shortcuts settings", () => {
  it("offers shortcuts in Desktop App without requiring a project or account", () => {
    const groups = resolveSettingsSidebarGroups({ cloudEnabled: false, accountAvailable: false, localWorkspaceAvailable: false });
    const desktop = groups.find(group => group.id === "desktop-app")!;
    expect(desktop.items.map(item => item.id)).toContain("keyboard-shortcuts");
    expect(desktop.items.findIndex(item => item.id === "keyboard-shortcuts"))
      .toBe(desktop.items.findIndex(item => item.id === "new-menu") + 1);
  });
  it("shows all Markdown aliases with application, explorer, table, and chat scopes", () => {
    const host = render();
    expect(host.textContent).toContain("Keyboard shortcuts");
    expect(host.textContent).toContain("File explorer");
    expect(host.textContent).toContain("Agent and Terminal");
    const quote = host.querySelector('[data-shortcut-id="markdown.quote"]');
    expect(quote?.textContent).toContain("Quote");
    expect(quote?.querySelectorAll(".desktop-shortcut-chord")).toHaveLength(2);
    expect(quote?.textContent).toContain("⌘");
    expect(quote?.textContent).toContain("⌥");
  });
  it("switches platform-specific keys and keeps search usable", () => {
    const host = render();
    const windows = [...host.querySelectorAll("button")].find(button => button.textContent === "Windows")!;
    act(() => windows.click());
    const redo = host.querySelector('[data-shortcut-id="editing.redo"]');
    expect(redo?.textContent).toContain("Ctrl");
    expect(redo?.textContent).toContain("Y");
    expect(host.querySelector('[data-shortcut-id="markdown.codeBlock"]')?.textContent).toContain("Shift");
  });
  it("filters by command name or key and shows a localized empty state", () => {
    const host = render();
    search(host, "code block");
    expect(host.querySelector('[data-shortcut-id="markdown.codeBlock"]')).not.toBeNull();
    expect(host.querySelector('[data-shortcut-id="markdown.quote"]')).toBeNull();
    search(host, "no-such-command-92817");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(0);
    expect(host.textContent).toContain("No shortcuts found");
    const clear = host.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')!;
    act(() => clear.click());
    expect(host.querySelector('[data-shortcut-id="markdown.quote"]')).not.toBeNull();
  });
  it("accepts readable modifier names and plus-separated chords", () => {
    const host = render();
    search(host, "cmd option c");
    expect(host.querySelector('[data-shortcut-id="markdown.codeBlock"]')).not.toBeNull();
    search(host, "command option minus");
    expect(host.querySelector('[data-shortcut-id="markdown.horizontalRule"]')).not.toBeNull();
    const windows = [...host.querySelectorAll("button")].find(button => button.textContent === "Windows")!;
    act(() => windows.click());
    search(host, "Ctrl+Shift+C");
    expect(host.querySelector('[data-shortcut-id="markdown.codeBlock"]')).not.toBeNull();
  });
});
