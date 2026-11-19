/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rfbInstances, MockRfb } = vi.hoisted(() => {
  type MockRfbInstance = EventTarget & {
    viewOnly: boolean;
    focusOnClick: boolean;
    clipViewport: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    showDotCursor: boolean;
    background: string;
    qualityLevel: number;
    compressionLevel: number;
    readonly focus: ReturnType<typeof vi.fn>;
    readonly blur: ReturnType<typeof vi.fn>;
    readonly disconnect: ReturnType<typeof vi.fn>;
    readonly target: HTMLElement;
    readonly url: string;
  };
  const instances: MockRfbInstance[] = [];
  class HoistedMockRfb extends EventTarget {
    viewOnly = false;
    focusOnClick = true;
    clipViewport = false;
    scaleViewport = false;
    resizeSession = false;
    showDotCursor = false;
    background = "";
    qualityLevel = 6;
    compressionLevel = 2;
    readonly focus = vi.fn();
    readonly blur = vi.fn();
    readonly disconnect = vi.fn();
    readonly target: HTMLElement;
    readonly url: string;

    constructor(target: HTMLElement, url: string) {
      super();
      this.target = target;
      this.url = url;
      instances.push(this);
    }
  }
  return { rfbInstances: instances, MockRfb: HoistedMockRfb };
});

vi.mock("@novnc/novnc", () => ({
  default: MockRfb,
}));

import { readCloudSandbox } from "../../../../src/features/cloud/sandbox/cloudSandboxFeatures";
import {
  CloudScreenLiveViewport,
  CloudScreenView,
  ComputerScreenSidebarEntry,
  ComputerScreenStage,
} from "../../../../src/features/cloud/sandbox/CloudComputerScreen";
import { VncScreenViewer } from "../../../../src/features/cloud/sandbox/VncScreenViewer";
import { withTestLocalization } from "../../../support/react/localization";
import { getByRole, queryByRole } from "../../../support/react/queries";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function createStreamingSandbox() {
  return readCloudSandbox({
    profile: "desktop",
    next_profile: "desktop",
    settings: {},
    features: [
      {
        id: "desktop",
        surface: null,
        transport: null,
        installed: true,
        enabled: true,
        reason: null,
        preview: false,
      },
      {
        id: "screen_stream",
        surface: "screen",
        transport: "vnc",
        installed: true,
        enabled: true,
        reason: null,
        preview: false,
      },
    ],
  });
}

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

beforeEach(() => {
  rfbInstances.length = 0;
  document.body.replaceChildren();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  document.body.replaceChildren();
});

describe("Computer screen explicit takeover gate", () => {
  it("keeps CloudScreenView read-only until 'Take control' is clicked, and releases on button or outside click", async () => {
    const host = document.createElement("div");
    const outsideButton = document.createElement("button");
    outsideButton.textContent = "Outside workbench";
    document.body.append(host, outsideButton);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        withTestLocalization(
          <CloudScreenView
            sandbox={createStreamingSandbox()}
            connect={async () => ({
              url: "ws://127.0.0.1:45123/vnc/ticket",
              protocols: ["binary"],
              transport: "vnc",
            })}
            onSettings={async () => {}}
            onWake={() => {}}
          />,
        ),
      );
    });
    await flushEffects();

    expect(rfbInstances).toHaveLength(1);
    const rfb = rfbInstances[0]!;
    expect(rfb.viewOnly).toBe(true);
    expect(rfb.focusOnClick).toBe(false);

    // Before VNC emits "connect", takeover button is not shown yet
    expect(queryByRole(host, "button", { name: "Take control" })).toBeNull();

    await act(async () => {
      rfb.dispatchEvent(new Event("connect"));
    });

    const stage = host.querySelector(".cloud-screen-live");
    const viewer = host.querySelector(".cloud-screen-viewer");
    expect(stage?.getAttribute("data-interactive")).toBe("false");
    expect(viewer?.getAttribute("data-interactive")).toBe("false");
    expect(rfb.viewOnly).toBe(true);

    // Hovering shows the "Take control" button; clicking it activates mouse & keyboard control
    const takeoverButton = getByRole(host, "button", { name: "Take control" });
    await act(async () => {
      takeoverButton.click();
    });

    expect(rfb.viewOnly).toBe(false);
    expect(rfb.focusOnClick).toBe(true);
    expect(rfb.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(stage?.getAttribute("data-interactive")).toBe("true");
    expect(viewer?.getAttribute("data-interactive")).toBe("true");
    expect(queryByRole(host, "button", { name: "Take control" })).toBeNull();

    // Clicking "Release control" returns to read-only mode
    rfb.blur.mockClear();
    const releaseButton = getByRole(host, "button", { name: "Release control" });
    await act(async () => {
      releaseButton.click();
    });

    expect(rfb.viewOnly).toBe(true);
    expect(rfb.focusOnClick).toBe(false);
    expect(rfb.blur).toHaveBeenCalledTimes(1);
    expect(stage?.getAttribute("data-interactive")).toBe("false");

    // Re-enter takeover, then click outside the screen stage (e.g. Explorer / Agent chat)
    await act(async () => {
      getByRole(host, "button", { name: "Take control" }).click();
    });
    expect(rfb.viewOnly).toBe(false);

    await act(async () => {
      outsideButton.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(rfb.viewOnly).toBe(true);
    expect(stage?.getAttribute("data-interactive")).toBe("false");
    expect(getByRole(host, "button", { name: "Take control" })).toBeTruthy();

    // Re-enter takeover, then press Escape to exit back to read-only mode
    await act(async () => {
      getByRole(host, "button", { name: "Take control" }).click();
    });
    expect(rfb.viewOnly).toBe(false);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(rfb.viewOnly).toBe(true);
    expect(stage?.getAttribute("data-interactive")).toBe("false");
  });

  it("renders ComputerScreenSidebarEntry with running status or inline Wake button when asleep", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);

    const onOpen = vi.fn();
    const onWake = vi.fn();

    await act(async () => {
      root?.render(
        withTestLocalization(
          <ComputerScreenSidebarEntry
            active={false}
            power="running"
            place="cloud"
            onOpen={onOpen}
            onWake={onWake}
          />,
        ),
      );
    });

    expect(host.textContent).toContain("Screen");
    expect(host.textContent).toContain("Running · Cloud");
    expect(queryByRole(host, "button", { name: "Wake it" })).toBeNull();

    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-computer-screen-sidebar-entry]")!.click();
    });
    expect(onOpen).toHaveBeenCalledTimes(1);

    await act(async () => {
      root?.render(
        withTestLocalization(
          <ComputerScreenSidebarEntry
            active={false}
            power="asleep"
            place="cloud"
            onOpen={onOpen}
            onWake={onWake}
          />,
        ),
      );
    });

    expect(host.textContent).toContain("Asleep");
    const wakeButton = getByRole(host, "button", { name: "Wake it" });
    await act(async () => {
      wakeButton.click();
    });
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("transitions persistently between Full-Pane and bottom-right PiP without disconnecting VNC", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);

    const onExpand = vi.fn();
    const onHidePip = vi.fn();
    const connect = vi.fn(async () => ({
      url: "ws://127.0.0.1:45125/vnc/persistent",
      protocols: ["binary"],
      transport: "vnc",
    }));

    const renderStage = async (mode: "full" | "pip", pipVisible = true) => {
      await act(async () => {
        root?.render(
          withTestLocalization(
            <ComputerScreenStage
              mode={mode}
              pipVisible={pipVisible}
              onExpandFromPip={onExpand}
              onHidePip={onHidePip}
            >
              <CloudScreenView
                sandbox={createStreamingSandbox()}
                connect={connect}
                onSettings={async () => {}}
                onWake={() => {}}
                mode={mode}
              />
            </ComputerScreenStage>,
          ),
        );
      });
    };

    await renderStage("full");
    await flushEffects();

    expect(rfbInstances).toHaveLength(1);
    const rfb = rfbInstances[0]!;
    await act(async () => {
      rfb.dispatchEvent(new Event("connect"));
    });

    // Take control in Full-Pane mode
    await act(async () => {
      getByRole(host, "button", { name: "Take control" }).click();
    });
    expect(rfb.viewOnly).toBe(false);

    // Switch to PiP when opening a file: VNC stays connected and exits takeover
    await renderStage("pip", true);
    expect(rfbInstances).toHaveLength(1);
    expect(rfb.disconnect).not.toHaveBeenCalled();
    expect(rfb.viewOnly).toBe(true);
    expect(host.querySelector("[data-computer-screen-stage]")?.getAttribute("data-mode")).toBe("pip");
    expect(queryByRole(host, "button", { name: "Take control" })).toBeNull();

    // Clicking PiP expands back to Full-Pane; clicking × hides PiP while keeping VNC alive
    await act(async () => {
      getByRole(host, "button", { name: "Expand screen" }).click();
    });
    expect(onExpand).toHaveBeenCalledTimes(1);

    await act(async () => {
      getByRole(host, "button", { name: "Hide picture-in-picture" }).click();
    });
    expect(onHidePip).toHaveBeenCalledTimes(1);

    await renderStage("pip", false);
    expect(host.querySelector("[data-computer-screen-stage]")?.getAttribute("data-pip-hidden")).toBe("true");
    expect(rfb.disconnect).not.toHaveBeenCalled();
  });

  it("applies the same explicit takeover gate to CloudScreenLiveViewport with toolbar overlays", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);

    const onSleep = vi.fn();

    await act(async () => {
      root?.render(
        withTestLocalization(
          <CloudScreenLiveViewport
            Viewer={VncScreenViewer}
            session={{
              url: "ws://127.0.0.1:45124/vnc/local",
              protocols: ["binary"],
              transport: "vnc",
            }}
            connecting={false}
            onStatus={() => {}}
            className="computer-mode-live-screen"
          >
            <div className="computer-mode-live-toolbar">
              <button type="button" onClick={onSleep}>
                Put to sleep
              </button>
            </div>
          </CloudScreenLiveViewport>,
        ),
      );
    });
    await flushEffects();

    expect(rfbInstances).toHaveLength(1);
    const rfb = rfbInstances[0]!;
    expect(rfb.viewOnly).toBe(true);

    const takeoverButton = getByRole(host, "button", { name: "Take control" });
    await act(async () => {
      takeoverButton.click();
    });
    expect(rfb.viewOnly).toBe(false);
    expect(getByRole(host, "button", { name: "Release control" })).toBeTruthy();
    expect(getByRole(host, "button", { name: "Put to sleep" })).toBeTruthy();
  });
});
