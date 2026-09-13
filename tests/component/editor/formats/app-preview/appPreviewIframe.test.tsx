/**
 * @vitest-environment happy-dom
 */
import type { AppPreviewController } from "@puppyone/shared-ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppPreviewViewer } from "../../../../../packages/shared-ui/src/editor/viewers/app/AppPreviewViewer";
import { resolveAppPreviewFrameUrl } from "../../../../../packages/shared-ui/src/editor/viewers/app/SandboxedAppFrame";
import { withTestLocalization } from "../../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("App Preview iframe", () => {
  it("renders the runtime as an actual editor-owned sandboxed iframe", async () => {
    const container = document.createElement("div");
    root = createRoot(container);
    const controller = {
      start: vi.fn(async () => ({
        runtimeId: "runtime-1",
        appId: "app-1",
        name: "Deck",
        status: "running" as const,
        path: "deck.puppyoneapp",
        url: "http://127.0.0.1:4173/",
      })),
    } as AppPreviewController;

    await act(async () => {
      root?.render(withTestLocalization(
        <AppPreviewViewer
          document={{ type: "app", path: "deck.puppyoneapp", name: "deck.puppyoneapp" }}
          content={configuredManifest()}
          loading={false}
          error={null}
          appPreview={controller}
        />,
      ));
      await Promise.resolve();
      await Promise.resolve();
    });

    const frame = container.querySelector<HTMLIFrameElement>("iframe[data-puppyone-app-frame]");
    expect(frame).not.toBeNull();
    expect(frame?.closest(".app-preview-surface-host")).not.toBeNull();
    expect(frame?.getAttribute("src")).toBe("http://127.0.0.1:4173/");
    expect(frame?.getAttribute("sandbox")).toBe("allow-forms allow-scripts allow-same-origin");
    expect(frame?.getAttribute("allow")).toContain("camera 'none'");
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");

    const sourceButton = container.querySelectorAll<HTMLButtonElement>(
      ".app-preview-toolbar button",
    )[1];
    act(() => sourceButton.click());
    expect(container.querySelector("iframe[data-puppyone-app-frame]")).toBe(frame);
    expect(frame?.closest(".app-preview-surface-host")?.getAttribute("data-active"))
      .toBe("false");
  });

  it("rejects same-origin, credentialed and non-web URLs", () => {
    expect(resolveAppPreviewFrameUrl("https://app.example.test/demo", "https://app.example.test"))
      .toBeNull();
    expect(resolveAppPreviewFrameUrl("https://user:secret@example.test/", "https://host.test"))
      .toBeNull();
    expect(resolveAppPreviewFrameUrl("file:///tmp/demo.html", "https://host.test")).toBeNull();
    expect(resolveAppPreviewFrameUrl("http://127.0.0.1:4173/", "file://"))
      .toBe("http://127.0.0.1:4173/");
  });
});

function configuredManifest() {
  return JSON.stringify({
    type: "puppyone.app",
    version: 1,
    name: "Deck",
    launch: {
      kind: "local-server",
      command: ["npm", "run", "dev"],
      cwd: ".",
      url: "http://127.0.0.1:${port}/",
    },
  });
}
