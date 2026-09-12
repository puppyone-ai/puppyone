/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppPreviewController } from "@puppyone/shared-ui";
import { AppPreviewSetupView } from "../../../../../packages/shared-ui/src/editor/viewers/app/AppPreviewSetupView";
import { withTestLocalization } from "../../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("App Preview onboarding", () => {
  it("detects read-only and starts a detected project without forcing the method chooser", async () => {
    const start = vi.fn();
    const configure = vi.fn(async () => ({ content: "configured" }));
    const detect = vi.fn(async () => ({
      projects: [{
        id: "vite-dev",
        cwd: ".",
        directoryLabel: ".",
        script: "dev",
        packageManager: "pnpm" as const,
        framework: "Vite",
        command: ["pnpm", "run", "dev", "--", "--host", "127.0.0.1", "--port", "${port}"],
        commandLabel: "pnpm run dev -- --host 127.0.0.1 --port ${port}",
        score: 150,
      }],
      htmlFiles: [],
    }));
    const onConfigured = vi.fn();
    const controller = { detect, configure, start } as unknown as AppPreviewController;
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(withTestLocalization(
        <AppPreviewSetupView
          appName="Untitled App"
          appPath="Untitled App.puppyoneapp"
          content={'{"type":"puppyone.app","version":1}'}
          controller={controller}
          onConfigured={onConfigured}
        />,
      ));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(detect).toHaveBeenCalledWith("Untitled App.puppyoneapp");
    expect(start).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Found a project to preview");
    expect(container.textContent).not.toContain("Choose project folder");

    await act(async () => {
      findButton(container, "Start this project")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(configure).toHaveBeenCalledWith(expect.objectContaining({
      name: "Untitled App",
      expectedContent: '{"type":"puppyone.app","version":1}',
      setup: expect.objectContaining({ kind: "local-server", cwd: "." }),
    }));
    expect(onConfigured).toHaveBeenCalledWith("configured");
    expect(start).not.toHaveBeenCalled();
  });

  it("reveals the alternate methods only after the user requests them", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const controller = {
      detect: vi.fn(async () => ({
        projects: [{
          id: "vite-dev",
          cwd: ".",
          directoryLabel: ".",
          script: "dev",
          packageManager: "npm" as const,
          framework: "Vite",
          command: ["npm", "run", "dev"],
          commandLabel: "npm run dev",
          score: 120,
        }],
        htmlFiles: [{ path: "index.html", label: "index.html" }],
      })),
    } as unknown as AppPreviewController;

    await act(async () => {
      root?.render(withTestLocalization(
        <AppPreviewSetupView
          appName="Demo"
          appPath="demo.puppyoneapp"
          content="{}"
          controller={controller}
          onConfigured={vi.fn()}
        />,
      ));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("Connect to a running webpage");

    act(() => findButton(container, "Choose another preview method")?.click());
    expect(container.textContent).toContain("Choose preview content");
    expect(container.textContent).toContain("Choose HTML file");
    expect(container.textContent).toContain("Connect to a running webpage");
  });

  it("explains an empty detection result before suggesting alternate methods", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const controller = {
      detect: vi.fn(async () => ({ projects: [], htmlFiles: [] })),
    } as unknown as AppPreviewController;

    await act(async () => {
      root?.render(withTestLocalization(
        <AppPreviewSetupView
          appName="Empty workspace"
          appPath="empty.puppyoneapp"
          content="{}"
          controller={controller}
          onConfigured={vi.fn()}
        />,
      ));
      await Promise.resolve();
      await Promise.resolve();
    });

    const content = container.textContent ?? "";
    expect(content).toContain("No runnable project detected");
    expect(content).toContain("PuppyOne checked this workspace");
    expect(content).toContain("Try one of these options");
    expect(content.indexOf("No runnable project detected"))
      .toBeLessThan(content.indexOf("Choose project folder"));
    expect(findButton(container, "Back")).toBeUndefined();
  });

  it("distinguishes unavailable detection from a successful empty result", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const controller = {
      detect: vi.fn(async () => Promise.reject(new Error("offline"))),
    } as unknown as AppPreviewController;

    await act(async () => {
      root?.render(withTestLocalization(
        <AppPreviewSetupView
          appName="Unavailable"
          appPath="unavailable.puppyoneapp"
          content="{}"
          controller={controller}
          onConfigured={vi.fn()}
        />,
      ));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Project detection was unavailable");
    expect(container.textContent).not.toContain("No runnable project detected");
  });

  it("opens Settings on the active launch method and preserves its values", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const controller = {
      detect: vi.fn(async () => ({ projects: [], htmlFiles: [] })),
    } as unknown as AppPreviewController;
    const content = JSON.stringify({
      type: "puppyone.app",
      version: 1,
      launch: {
        kind: "local-server",
        cwd: "slides",
        command: ["npm", "run", "dev", "--", "--open", "Team deck"],
        url: "http://127.0.0.1:${port}/speaker?notes=1",
      },
    });

    await act(async () => {
      root?.render(withTestLocalization(
        <AppPreviewSetupView
          appName="Demo"
          appPath="demo.puppyoneapp"
          content={content}
          controller={controller}
          settings
          onConfigured={vi.fn()}
        />,
      ));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Advanced settings");
    expect(findInputByLabel(container, "Working folder")?.value).toBe("slides");
    expect(findInputByLabel(container, "Start command")?.value)
      .toBe('npm run dev -- --open "Team deck"');
    expect(findInputByLabel(container, "Start path")?.value).toBe("/speaker?notes=1");
  });
});

function findButton(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll("button"))
    .find((button) => button.textContent?.replace(/\s+/g, " ").trim() === text);
}

function findInputByLabel(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll("label"))
    .find((label) => label.querySelector("span")?.textContent?.trim() === text)
    ?.querySelector("input");
}
