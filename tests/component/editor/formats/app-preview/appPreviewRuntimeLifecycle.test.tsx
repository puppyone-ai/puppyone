/**
 * @vitest-environment happy-dom
 */
import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppPreviewController, AppPreviewResult } from "@puppyone/shared-ui";
import { useAppPreviewSession } from "../../../../../packages/shared-ui/src/editor/viewers/app/useAppPreviewSession";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("App Preview runtime lifecycle", () => {
  it("does not invoke runtime capabilities while an App is unconfigured", async () => {
    const controller = {
      start: vi.fn(),
      subscribeRuntime: vi.fn(() => () => {}),
    } as unknown as AppPreviewController;
    const container = render(<Harness controller={controller} enabled={false} />);

    await act(async () => Promise.resolve());

    expect(controller.start).not.toHaveBeenCalled();
    expect(controller.subscribeRuntime).not.toHaveBeenCalled();
    expect(container.querySelector("[data-status]")?.getAttribute("data-status")).toBe("idle");
  });

  it("starts the process without any native bounds or attachment contract", async () => {
    const start = vi.fn(async () => runningResult("runtime-1"));
    const controller = { start } as unknown as AppPreviewController;
    const container = render(
      <StrictMode>
        <Harness controller={controller} />
      </StrictMode>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(start).toHaveBeenCalledWith("demo.puppyoneapp");
    expect(start).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-status]")?.getAttribute("data-status")).toBe("running");
    expect(container.querySelector("[data-url]")?.getAttribute("data-url"))
      .toBe("http://127.0.0.1:4173/");
  });

  it("ignores stale generations and out-of-order runtime snapshots", async () => {
    let runtimeListener: ((state: AppPreviewResult) => void) | null = null;
    const controller = {
      start: vi.fn(async () => ({ ...runningResult("runtime-2"), generation: 2, sequence: 2 })),
      subscribeRuntime: vi.fn((listener) => {
        runtimeListener = listener;
        return () => {};
      }),
    } as unknown as AppPreviewController;
    const container = render(<Harness controller={controller} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      runtimeListener?.({
        ...runningResult("runtime-1"),
        generation: 1,
        sequence: 99,
        status: "error",
        message: "old failure",
      });
      runtimeListener?.({
        ...runningResult("runtime-2"),
        generation: 2,
        sequence: 1,
        status: "error",
        message: "out of order",
      });
    });

    expect(container.querySelector("[data-status]")?.getAttribute("data-status")).toBe("running");
  });
});

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(node));
  return container;
}

function Harness({
  controller,
  enabled = true,
}: {
  controller: AppPreviewController;
  enabled?: boolean;
}) {
  const session = useAppPreviewSession({
    appPreview: controller,
    path: "demo.puppyoneapp",
    enabled,
  });
  return (
    <div
      data-status={session.state.status}
      data-url={session.state.runtime?.url ?? undefined}
    />
  );
}

function runningResult(runtimeId: string): AppPreviewResult {
  return {
    runtimeId,
    appId: "app-1",
    name: "Demo",
    status: "running",
    path: "demo.puppyoneapp",
    url: "http://127.0.0.1:4173/",
  };
}
