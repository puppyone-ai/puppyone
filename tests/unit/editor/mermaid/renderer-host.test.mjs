import { describe, expect, it, vi } from "vitest";
import { createMermaidRendererHost } from "../../../../electron/main/mermaid/renderer-host.mjs";

const assetRoot = "file:///Applications/PuppyOne.app/Contents/Resources/app.asar/dist/";

function createHostRequestFilter(root) {
  let filter;
  const isolatedSession = {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    webRequest: { onBeforeRequest: (listener) => { filter = listener; } },
  };
  class FakeView {
    webContents = {
      ipc: { on: vi.fn() },
      loadURL: vi.fn(async () => undefined),
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
  }
  createMermaidRendererHost({
    WebContentsView: FakeView,
    session: { fromPartition: () => isolatedSession },
    url: new URL("src/platform/mermaid/host.html", root ?? assetRoot).href,
    assetRoot: root,
    preload: "/app/electron/mermaid-preload.cjs",
  });
  return (url, resourceType) => new Promise((resolve) => {
    filter({ url, resourceType }, ({ cancel }) => resolve(!cancel));
  });
}

describe("Mermaid host request boundary", () => {
  it.each([
    ["src/platform/mermaid/host.html", "mainFrame"],
    ["assets/mermaid.js", "script"],
    ["assets/mermaid.css", "stylesheet"],
    ["fonts/open-sans.woff2", "font"],
  ])("loads %s from the renderer build", async (file, resourceType) => {
    const isAllowed = createHostRequestFilter(assetRoot);
    await expect(isAllowed(new URL(file, assetRoot).href, resourceType)).resolves.toBe(true);
  });

  it.each([
    ["file:///etc/passwd", "script"],
    ["file:///Applications/PuppyOne.app/Contents/Resources/app.asar/electron/main.mjs", "script"],
    ["https://example.com/mermaid.js", "script"],
    [`${assetRoot}assets/diagram.png`, "image"],
    [`${assetRoot}api`, "xhr"],
  ])("blocks %s as %s", async (url, resourceType) => {
    const isAllowed = createHostRequestFilter(assetRoot);
    await expect(isAllowed(url, resourceType)).resolves.toBe(false);
  });

  it("does not start without an explicit asset root", () => {
    expect(() => createHostRequestFilter(undefined)).toThrow();
  });
});
