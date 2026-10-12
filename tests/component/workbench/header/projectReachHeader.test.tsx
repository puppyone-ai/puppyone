/** @vitest-environment happy-dom */
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopTitlebarContext } from "../../../../src/features/app-shell/DesktopTitlebarContext";
import {
  ProjectReachControl,
  resolveProjectReachState,
  type ProjectReachControlProps,
  type ReachDestination,
  type ReachShareKind,
} from "../../../../src/features/app-shell/project-reach";
import { initializeDesktopPreferences } from "../../../../src/preferencesStore";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../../../../src/platform/useDesktopPlatformCapabilities", () => ({
  useDesktopPlatformCapabilities: () => ({ platform: "macos" }),
}));

const destinations: readonly ReachDestination[] = [
  { id: "viktor", brand: "Viktor", label: "Viktor" },
  { id: "person", brand: null, label: "A person" },
];
const workspace = { id: "one", name: "Workspace one", path: "/tmp/one", status: "recording" as const };
const noOp = () => {};
const projectProps = {
  open: false, refObject: createRef<HTMLDivElement>(), workspace, titlebarLabel: workspace.name,
  workspaceFolders: [], multiRootWorkspacesEnabled: false, onClose: noOp, onToggle: noOp,
  availableProjects: [workspace],
};

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  initializeDesktopPreferences();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function render(content: React.ReactNode) {
  await act(async () => root.render(withTestLocalization(content)));
}

function state({ share, shares = [], ...rest }: {
  share: ReachShareKind;
  shares?: ReadonlyArray<{ id: string; name: string; lastSeenAt?: string | null }>;
  activity?: Record<string, { kind: "reading" | "writing"; label: string } | undefined>;
  deviceCopyAvailable?: boolean;
  waitingFor?: string | null;
}) {
  return resolveProjectReachState({
    share,
    destinations,
    shares: shares.map((entry) => ({ ...entry, lastSeenAt: entry.lastSeenAt ?? null })),
    ...rest,
  });
}

async function renderControl(props: Partial<ProjectReachControlProps> & Pick<ProjectReachControlProps, "state">) {
  await render(<ProjectReachControl {...props} />);
  return container.querySelector<HTMLButtonElement>(".desktop-titlebar-reach-button")!;
}

function openPanel() {
  act(() => container.querySelector<HTMLButtonElement>(".desktop-titlebar-reach-button")!.click());
  const panel = document.querySelector<HTMLElement>(".desktop-project-reach-panel");
  if (!panel) throw new Error("The reach panel did not open");
  return panel;
}

function action(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>(".desktop-project-reach-action")]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!button) throw new Error(`Missing action: ${label}`);
  return button;
}

describe("Header project reach", () => {
  it("says only you without a badge, a count or emphasis", async () => {
    const button = await renderControl({ state: state({ share: "published" }) });
    expect(button.getAttribute("aria-label")).toBe("Only you can reach this project");
    expect(button.dataset.reachEmphasis).toBeUndefined();
    expect(container.querySelector(".desktop-project-reach-count")).toBeNull();
    expect(container.querySelector('.desktop-project-reach-marks[data-reach-audience="none"]')).not.toBeNull();
  });

  it("states who can reach it with round people and square machines", async () => {
    const button = await renderControl({
      state: state({
        share: "shared",
        shares: [
          { id: "1", name: "A person", lastSeenAt: new Date(Date.now() - 14 * 60_000).toISOString() },
          { id: "2", name: "Viktor" },
        ],
      }),
    });
    expect(button.getAttribute("aria-label")).toBe("2 others can reach this project");
    const marks = [...container.querySelectorAll(".desktop-project-reach-mark")];
    expect(marks.map((mark) => mark.getAttribute("data-reach-audience"))).toEqual(["person", "machine"]);
    expect(container.querySelector(".desktop-project-reach-count")?.textContent).toBe("2");
    expect(button.dataset.reachEmphasis).toBeUndefined();
  });

  it("keeps waiting for a first read as a statement about the destination", async () => {
    const button = await renderControl({
      state: state({ share: "waiting", shares: [{ id: "1", name: "Viktor" }], waitingFor: "Viktor" }),
    });
    expect(button.getAttribute("aria-label")).toContain("Waiting for");
    expect(button.getAttribute("aria-label")).toContain("Viktor");
    expect(button.dataset.reachEmphasis).toBeUndefined();
  });

  it("states activity while an agent is working, and marks the working destination", async () => {
    const button = await renderControl({
      state: state({
        share: "shared",
        shares: [{ id: "1", name: "Viktor" }],
        activity: { "1": { kind: "writing", label: "Viktor" } },
      }),
    });
    expect(button.getAttribute("aria-label")).toContain("is working in this project right now");
    expect(container.querySelector('.desktop-project-reach-mark[data-reach-activity="writing"]')).not.toBeNull();
  });

  it("emphasizes reach that needs attention, and nothing else", async () => {
    const attention = await renderControl({ state: state({ share: "attention" }) });
    expect(attention.dataset.reachEmphasis).toBe("true");
    expect(attention.getAttribute("aria-label")).toBe("This project cannot be reached right now");
  });

  it("offers a copy, and no share actions, while the project is not on this device", async () => {
    const getCopy = vi.fn();
    const button = await renderControl({
      state: state({ share: "shared", shares: [{ id: "1", name: "Viktor" }], deviceCopyAvailable: false }),
      readers: <p data-testid="readers">readers</p>,
      onGetCopy: getCopy,
      onInvitePerson: noOp,
      onConnectAgent: noOp,
    });
    expect(button.getAttribute("aria-label")).toBe("This project is not on this Mac yet");
    const panel = openPanel();
    expect(panel.querySelector('[data-testid="readers"]')).toBeNull();
    expect(panel.textContent).toContain("Changing it needs a copy of it here.");
    act(() => action("Get a copy").click());
    expect(getCopy).toHaveBeenCalledTimes(1);
  });

  it("hosts the shared readers list and the two verbs, without location selection syntax", async () => {
    const invite = vi.fn();
    const connect = vi.fn();
    await renderControl({
      state: state({ share: "shared", shares: [{ id: "1", name: "A person" }] }),
      readers: <p data-testid="readers">readers</p>,
      onInvitePerson: invite,
      onConnectAgent: connect,
    });
    const panel = openPanel();
    expect(panel.querySelector('[data-testid="readers"]')).not.toBeNull();
    act(() => action("Invite a person").click());
    act(() => action("Connect an agent").click());
    expect([invite.mock.calls.length, connect.mock.calls.length]).toEqual([1, 1]);
    expect(document.querySelector("[aria-pressed]")).toBeNull();
    expect(document.querySelector("[data-project-location]")).toBeNull();
    expect(document.querySelector(".desktop-project-location-tabs")).toBeNull();
  });
});

describe("Header reach fork", () => {
  const reach: ProjectReachControlProps = { state: resolveProjectReachState({ share: "published", shares: [], destinations }) };

  it("keeps the established location control until the experience is handed to the Header", async () => {
    await render(<DesktopTitlebarContext {...projectProps}
      projectLocation={{ current: "local", localAvailable: true, cloudState: "available" }} onViewCloud={noOp} />);
    expect(container.querySelector(".desktop-titlebar-location-button")).not.toBeNull();
    expect(container.querySelector(".desktop-titlebar-reach-button")).toBeNull();
  });

  it("replaces it at the same render entry, leaving no second location control behind", async () => {
    await render(<DesktopTitlebarContext {...projectProps} projectReach={reach}
      projectLocation={{ current: "local", localAvailable: true, cloudState: "available" }} onViewCloud={noOp} />);
    expect(container.querySelector(".desktop-titlebar-reach-button")).not.toBeNull();
    expect(container.querySelector(".desktop-titlebar-location-button")).toBeNull();
    expect(container.querySelector(".desktop-project-location-controls")).toBeNull();
  });
});
