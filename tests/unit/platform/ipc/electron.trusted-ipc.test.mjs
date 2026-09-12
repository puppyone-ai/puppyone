import { describe, expect, it, vi } from "vitest";
import {
  assertTrustedIpcEvent,
  createTrustedIpcMain,
  isTrustedApplicationFrameUrl,
} from "../../../../electron/main/trusted-ipc.mjs";

describe("trusted Electron IPC facade", () => {
  it("accepts only the exact packaged document or exact development origin", () => {
    const packagedUrl = "file:///Applications/PuppyOne.app/Contents/Resources/app.asar/dist/index.html";
    expect(isTrustedApplicationFrameUrl(`${packagedUrl}#workspace`, packagedUrl)).toBe(true);
    expect(isTrustedApplicationFrameUrl(`${packagedUrl}?spoof=1`, packagedUrl)).toBe(false);
    expect(isTrustedApplicationFrameUrl(
      "file:///Applications/PuppyOne.app/Contents/Resources/app.asar/dist/other.html",
      packagedUrl,
    )).toBe(false);

    const devUrl = "http://127.0.0.1:5173/";
    expect(isTrustedApplicationFrameUrl("http://127.0.0.1:5173/settings", devUrl)).toBe(true);
    expect(isTrustedApplicationFrameUrl("http://localhost:5173/settings", devUrl)).toBe(false);
    expect(isTrustedApplicationFrameUrl("http://127.0.0.1:5174/settings", devUrl)).toBe(false);
    expect(isTrustedApplicationFrameUrl("https://127.0.0.1:5173/settings", devUrl)).toBe(false);
  });

  it("requires senderFrame to be the sender mainFrame", () => {
    const applicationUrl = "file:///app/dist/index.html";
    const mainFrame = { url: applicationUrl };
    const sender = { mainFrame };
    expect(() => assertTrustedIpcEvent({ sender, senderFrame: mainFrame }, applicationUrl)).not.toThrow();

    expect(() => assertTrustedIpcEvent({
      sender,
      senderFrame: { url: applicationUrl },
    }, applicationUrl)).toThrow(/main frame/i);
    expect(() => assertTrustedIpcEvent({
      sender,
      senderFrame: { url: "file:///tmp/untrusted.html" },
    }, applicationUrl)).toThrow(/main frame/i);

    const untrustedMainFrame = { url: "file:///tmp/untrusted.html" };
    expect(() => assertTrustedIpcEvent({
      sender: { mainFrame: untrustedMainFrame },
      senderFrame: untrustedMainFrame,
    }, applicationUrl)).toThrow(/trusted application URL/i);
  });

  it("guards both invoke handlers and one-way listeners", async () => {
    const handles = new Map();
    const listeners = new Map();
    const ipcMain = {
      handle: vi.fn((channel, listener) => handles.set(channel, listener)),
      on: vi.fn((channel, listener) => listeners.set(channel, listener)),
    };
    const logger = { warn: vi.fn() };
    const applicationUrl = "file:///app/dist/index.html";
    const trustedIpc = createTrustedIpcMain({ ipcMain, applicationUrl, logger });
    const invoked = vi.fn(async (_event, value) => value * 2);
    const received = vi.fn();
    trustedIpc.handle("secure:invoke", invoked);
    trustedIpc.on("secure:event", received);

    const trustedFrame = { url: `${applicationUrl}#home` };
    const trustedEvent = {
      sender: { mainFrame: trustedFrame },
      senderFrame: trustedFrame,
      preventDefault: vi.fn(),
    };
    await expect(handles.get("secure:invoke")(trustedEvent, 21)).resolves.toBe(42);
    listeners.get("secure:event")(trustedEvent, "ok");
    expect(invoked).toHaveBeenCalledOnce();
    expect(received).toHaveBeenCalledWith(trustedEvent, "ok");

    const subframe = { url: applicationUrl };
    const rejectedEvent = {
      sender: { mainFrame: trustedFrame },
      senderFrame: subframe,
      preventDefault: vi.fn(),
    };
    await expect(handles.get("secure:invoke")(rejectedEvent, 1)).rejects.toThrow(/main frame/i);
    listeners.get("secure:event")(rejectedEvent, "blocked");
    expect(received).toHaveBeenCalledTimes(1);
    expect(rejectedEvent.preventDefault).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});
