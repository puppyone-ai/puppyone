import { describe, expect, it, vi } from "vitest";
import {
  attachMarkdownFormatShortcuts,
  dispatchMarkdownEditorCommand,
  isMarkdownEditorActive,
  matchMarkdownFormatInput,
  MARKDOWN_FORMAT_SHORTCUT_CHANNEL,
  registerMarkdownFormatIpcHandlers,
  setMarkdownFormatShortcutsActive,
} from "../electron/main/ipc/markdown-format-ipc.mjs";

describe("Markdown format window shortcuts", () => {
  it("matches the complete macOS format shortcut set", () => {
    expect(matchMarkdownFormatInput({
      type: "keyDown",
      key: "b",
      meta: true,
    }, "darwin")).toBe("strong");
    expect(matchMarkdownFormatInput({
      type: "keyDown",
      key: "i",
      meta: true,
    }, "darwin")).toBe("emphasis");
    expect(matchMarkdownFormatInput({
      type: "keyDown",
      key: "u",
      meta: true,
    }, "darwin")).toBe("underline");
    expect(matchMarkdownFormatInput({
      type: "keyDown",
      key: "d",
      meta: true,
    }, "darwin")).toBe("strike");
    expect(matchMarkdownFormatInput({
      type: "keyDown",
      key: "x",
      meta: true,
      shift: true,
    }, "darwin")).toBe("strike");
    expect(matchMarkdownFormatInput({
      type: "keyDown",
      key: "h",
      meta: true,
      shift: true,
    }, "darwin")).toBe("highlight");
  });

  it.each(["win32", "linux"])("uses Control instead of Command on %s", (platform) => {
    expect(matchMarkdownFormatInput({
      type: "keyDown",
      key: "b",
      control: true,
    }, platform)).toBe("strong");
    expect(matchMarkdownFormatInput({
      type: "keyDown",
      key: "i",
      control: true,
    }, platform)).toBe("emphasis");
    expect(matchMarkdownFormatInput({
      type: "keyDown",
      key: "u",
      control: true,
    }, platform)).toBe("underline");
    expect(matchMarkdownFormatInput({
      type: "keyDown",
      key: "d",
      control: true,
    }, platform)).toBe("strike");
    expect(matchMarkdownFormatInput({
      type: "keyDown",
      key: "x",
      control: true,
      shift: true,
    }, platform)).toBe("strike");
    expect(matchMarkdownFormatInput({
      type: "keyDown",
      key: "h",
      control: true,
      shift: true,
    }, platform)).toBe("highlight");
  });

  it("rejects repeated, modified, released, and cross-platform modifier inputs", () => {
    expect(matchMarkdownFormatInput({
      type: "keyDown",
      key: "i",
      meta: true,
      isAutoRepeat: true,
    }, "darwin")).toBeNull();
    expect(matchMarkdownFormatInput({
      type: "keyDown",
      key: "i",
      meta: true,
      alt: true,
    }, "darwin")).toBeNull();
    expect(matchMarkdownFormatInput({
      type: "keyUp",
      key: "i",
      meta: true,
    }, "darwin")).toBeNull();
    expect(matchMarkdownFormatInput({
      type: "keyDown",
      key: "i",
      control: true,
    }, "darwin")).toBeNull();
    expect(matchMarkdownFormatInput({
      type: "keyDown",
      key: "i",
      meta: true,
    }, "linux")).toBeNull();
    expect(matchMarkdownFormatInput({
      type: "keyDown",
      key: "i",
      meta: true,
      control: true,
    }, "darwin")).toBeNull();
  });

  it.each([
    ["darwin", { meta: true }],
    ["win32", { control: true }],
    ["linux", { control: true }],
  ])("prevents default and forwards only from a focused Markdown editor on %s", (platform, modifier) => {
    const sent = [];
    const listeners = new Map();
    const webContents = {
      id: platform === "darwin" ? 17 : platform === "win32" ? 18 : 19,
      isDestroyed: () => false,
      send(channel, payload) {
        sent.push({ channel, payload });
      },
      on(channel, listener) {
        listeners.set(channel, listener);
      },
      once() {},
      removeListener() {},
    };

    const controller = attachMarkdownFormatShortcuts(webContents, { platform });
    const beforeInput = listeners.get("before-input-event");
    const event = { preventDefault() { event.prevented = true; }, prevented: false };

    beforeInput(event, { type: "keyDown", key: "i", ...modifier });
    expect(event.prevented).toBe(false);
    expect(sent).toEqual([]);

    setMarkdownFormatShortcutsActive(webContents.id, true);
    beforeInput(event, { type: "keyDown", key: "i", ...modifier });
    expect(event.prevented).toBe(true);
    expect(sent).toEqual([
      { channel: MARKDOWN_FORMAT_SHORTCUT_CHANNEL, payload: { type: "emphasis" } },
    ]);
    controller.dispose();
  });

  it("updates the focused editor from trusted IPC", () => {
    const sent = [];
    const listeners = new Map();
    const webContents = {
      id: 21,
      isDestroyed: () => false,
      send(channel, payload) {
        sent.push({ channel, payload });
      },
      on(channel, listener) {
        listeners.set(channel, listener);
      },
      once() {},
      removeListener() {},
    };
    const controller = attachMarkdownFormatShortcuts(webContents, { platform: "darwin" });

    const ipcListeners = new Map();
    const onActiveChange = vi.fn();
    registerMarkdownFormatIpcHandlers({
      ipcMain: {
        on(channel, listener) {
          ipcListeners.set(channel, listener);
        },
      },
      onActiveChange,
    });

    ipcListeners.get("editor:markdown-format-active")({ sender: { id: 21 } }, { active: true });
    const beforeInput = listeners.get("before-input-event");
    const event = { preventDefault() { event.prevented = true; }, prevented: false };
    beforeInput(event, { type: "keyDown", key: "b", meta: true });
    expect(sent[0]).toEqual({
      channel: MARKDOWN_FORMAT_SHORTCUT_CHANNEL,
      payload: { type: "strong" },
    });
    expect(onActiveChange).toHaveBeenCalledWith({ active: true, webContentsId: 21 });
    controller.dispose();
  });

  it("forwards native menu commands only to an active Markdown editor", () => {
    const sent = [];
    const webContents = {
      id: 22,
      isDestroyed: () => false,
      send(channel, payload) {
        sent.push({ channel, payload });
      },
      on() {},
      once() {},
      removeListener() {},
    };
    const controller = attachMarkdownFormatShortcuts(webContents);

    expect(isMarkdownEditorActive(webContents.id)).toBe(false);
    expect(dispatchMarkdownEditorCommand(webContents, "math-block")).toBe(false);
    controller.setActive(true);
    expect(isMarkdownEditorActive(webContents.id)).toBe(true);
    expect(dispatchMarkdownEditorCommand(webContents, "math-block")).toBe(true);
    expect(dispatchMarkdownEditorCommand(webContents, "not-a-command")).toBe(false);
    expect(sent).toEqual([{
      channel: "editor:markdown-command",
      payload: { type: "math-block" },
    }]);
    controller.dispose();
  });
});
