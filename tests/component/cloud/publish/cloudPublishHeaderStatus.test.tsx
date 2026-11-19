/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudPublishHeaderStatus } from "../../../../src/features/cloud/initialization/CloudPublishHeaderStatus";
import { CloudPublishRunning } from "../../../../src/features/cloud/initialization/CloudPublishRunning";
import { CloudProjectActivationScope } from "../../../../src/features/cloud/components/CloudProjectActivation";
import type { CloudInitializationOutcome } from "../../../../src/features/cloud/initialization/useCloudInitialization";
import {
  CLOUD_PUBLISH_COMPLETED_VISIBLE_MS,
  useCloudPublishHeaderStatus,
} from "../../../../src/features/cloud/initialization/useCloudPublishHeaderStatus";
import type { CloudInitializationProgress, CloudPublishProgressStage } from "../../../../src/types/electron";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type HarnessProps = {
  progress: CloudInitializationProgress | null;
  outcome: CloudInitializationOutcome | null;
  pausedStage?: CloudPublishProgressStage | null;
  pausedDiscard?: boolean;
  surfaceOpen: boolean;
  onOpen: () => void;
};

function Harness({ progress, outcome, pausedStage, pausedDiscard, surfaceOpen, onOpen }: HarnessProps) {
  const { status, acknowledge } = useCloudPublishHeaderStatus({ progress, outcome, pausedStage, pausedDiscard, surfaceOpen });
  return <CloudPublishHeaderStatus status={status} onOpen={() => { acknowledge(); onOpen(); }} />;
}

const uploading: CloudInitializationProgress = {
  rootPath: "/tmp/notes",
  operationId: "publish-1",
  stage: "uploading",
  state: null,
  updatedAt: "2026-10-22T00:00:00.000Z",
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function render(props: Partial<HarnessProps> & { onOpen?: () => void }) {
  act(() => root.render(withTestLocalization(<Harness
    progress={props.progress ?? null}
    outcome={props.outcome ?? null}
    pausedStage={props.pausedStage ?? null}
    pausedDiscard={props.pausedDiscard ?? false}
    surfaceOpen={props.surfaceOpen ?? false}
    onOpen={props.onOpen ?? (() => undefined)}
  />)));
}

const control = () => host.querySelector<HTMLButtonElement>(".desktop-titlebar-publish-status");

describe("Cloud publish Header status", () => {
  it("states an unwatched run with step progress and reopens it on click", () => {
    const onOpen = vi.fn();
    render({ progress: uploading, onOpen });
    expect(control()?.dataset.publishStatus).toBe("running");
    // A mark alone: the words are its accessible name and tooltip, not visible text.
    expect(control()?.textContent).toBe("");
    expect(control()?.getAttribute("aria-label")).toBe("Sending to the cloud. Uploading and publishing files…");
    // A spinner that turns, the same one the publish dialog draws on its step.
    const spinner = host.querySelector(".desktop-titlebar-publish-status-spinner");
    expect(spinner?.classList.contains("animate-spin")).toBe(true);
    expect(host.querySelector(".lucide-triangle-alert")).toBeNull();
    act(() => control()?.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("answers an unwatched upload with how far it has got", () => {
    render({ progress: { ...uploading, transfer: { percent: 45, sentBytes: 12_340_000, bytesPerSecond: 1_060_000 } } });
    expect(control()?.dataset.publishStatus).toBe("running");
    expect(control()?.getAttribute("aria-label")).toBe("Sending to the cloud. 45% · 12.3 MB · 1.1 MB/s");
  });

  it("keeps spinning while the dialog shows the run, but leaves its ending to the dialog", () => {
    // A running send is true wherever the user is looking, so it is stated
    // even beside the surface that shows it.
    render({ progress: uploading, surfaceOpen: true });
    expect(control()?.dataset.publishStatus).toBe("running");
    expect(host.querySelector(".desktop-titlebar-publish-status-spinner")).not.toBeNull();
    const outcome = { kind: "failed" } as const;
    render({ outcome, surfaceOpen: true });
    expect(control()).toBeNull();
    // Closing the dialog after the user saw the ending does not repeat it.
    render({ outcome, surfaceOpen: false });
    expect(control()).toBeNull();
  });

  it("keeps an unwatched failure until the user looks at it", () => {
    vi.useFakeTimers();
    const outcome = { kind: "failed" } as const;
    render({ progress: uploading });
    render({ outcome });
    expect(control()?.dataset.publishStatus).toBe("attention");
    expect(host.querySelector(".lucide-triangle-alert")).not.toBeNull();
    expect(host.querySelector(".desktop-titlebar-publish-status-spinner")).toBeNull();
    act(() => { vi.advanceTimersByTime(CLOUD_PUBLISH_COMPLETED_VISIBLE_MS * 2); });
    expect(control()?.dataset.publishStatus).toBe("attention");
    act(() => control()?.click());
    expect(control()).toBeNull();
  });

  it("keeps a saved unfinished publish visible as a warning, even after the app restarts", () => {
    const onOpen = vi.fn();
    // A fresh window: no run and no ending in this session, only the saved state.
    render({ pausedStage: "uploading", onOpen });
    expect(control()?.dataset.publishStatus).toBe("paused");
    // Nobody paused it: it was interrupted, so it is a warning, never a pause mark.
    expect(host.querySelector(".lucide-triangle-alert")).not.toBeNull();
    expect(host.querySelector(".lucide-pause")).toBeNull();
    expect(control()?.getAttribute("aria-label")).toBe("Sending didn’t finish. It was interrupted. Click to retry.");
    act(() => control()?.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
    // Looking at it does not make it go away; only continuing or deleting does.
    expect(control()?.dataset.publishStatus).toBe("paused");
    render({ pausedStage: "uploading", surfaceOpen: true, onOpen });
    expect(control()).toBeNull();
    render({ pausedStage: null, onOpen });
    expect(control()).toBeNull();
  });

  it("turns the warning into a spinner the moment a retry restarts the send", () => {
    const failed = { kind: "failed" } as const;
    // Interrupted earlier: a warning.
    render({ pausedStage: "uploading" });
    expect(control()?.dataset.publishStatus).toBe("paused");
    // Clicking it opens the run, and Retry starts the whole send again. The
    // surface is open, and the Header still spins for the whole run.
    render({ pausedStage: "uploading", surfaceOpen: true });
    expect(control()).toBeNull();
    render({ progress: { ...uploading, stage: "validating" }, surfaceOpen: true });
    expect(control()?.dataset.publishStatus).toBe("running");
    expect(host.querySelector(".lucide-triangle-alert")).toBeNull();
    render({ progress: uploading, surfaceOpen: false });
    expect(control()?.dataset.publishStatus).toBe("running");
    // It fails again while unwatched: back to a warning, never a blank Header.
    render({ outcome: failed, pausedStage: "uploading" });
    expect(control()?.dataset.publishStatus).toBe("attention");
    expect(host.querySelector(".lucide-triangle-alert")).not.toBeNull();
  });

  it("states an unfinished discard as a discard, never as a send to retry", () => {
    render({ pausedStage: "uploading", pausedDiscard: true });
    expect(control()?.dataset.publishStatus).toBe("paused");
    expect(host.querySelector(".lucide-triangle-alert")).not.toBeNull();
    expect(control()?.getAttribute("aria-label"))
      .toBe("Discard didn’t finish. The empty cloud project is still there. Click to finish.");
    expect(control()?.getAttribute("aria-label")).not.toMatch(/retry|sending/i);
  });

  it("states a fresh failure first, then the paused task it leaves behind", () => {
    const outcome = { kind: "failed" } as const;
    render({ outcome, pausedStage: "uploading" });
    expect(control()?.dataset.publishStatus).toBe("attention");
    act(() => control()?.click());
    expect(control()?.dataset.publishStatus).toBe("paused");
  });

  it("announces an unwatched success briefly", () => {
    vi.useFakeTimers();
    render({ outcome: { kind: "published" } });
    expect(control()?.dataset.publishStatus).toBe("completed");
    expect(control()?.getAttribute("aria-label")).toContain("Ready in the cloud");
    act(() => { vi.advanceTimersByTime(CLOUD_PUBLISH_COMPLETED_VISIBLE_MS); });
    expect(control()).toBeNull();
  });
});

describe("Cloud publish running view", () => {
  it("continues the activation banner and lets the dialog go without stopping the run", () => {
    const onDismiss = vi.fn();
    act(() => root.render(withTestLocalization(
      <CloudProjectActivationScope projectName="Notes" onDismiss={onDismiss}>
        <CloudPublishRunning projectName="Notes" stage="uploading" />
      </CloudProjectActivationScope>,
    )));
    const running = host.querySelector(".desktop-cloud-publish-running");
    expect(running?.querySelector(".desktop-cloud-project-activation")?.getAttribute("aria-busy")).toBe("true");
    expect(running?.querySelector(".desktop-cloud-project-activation-title")?.textContent).toContain("Notes");
    // Declining makes no sense once it runs; the only way out is the background.
    expect(running?.textContent).not.toContain("Not now");
    const hide = running?.querySelector<HTMLButtonElement>(".desktop-cloud-publish-running-hide");
    expect(hide?.textContent).toBe("Continue in background");
    act(() => hide?.click());
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
