/** @vitest-environment happy-dom */
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopTitlebarContext } from "../../../../src/features/app-shell/DesktopTitlebarContext";
import {
  ProjectReachControl,
  ProjectReachPeople,
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
  place?: "this-device" | "cloud";
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
  it("says where the project is, and says nothing about reach when nobody else is there", async () => {
    const button = await renderControl({ state: state({ share: "published" }) });
    // The place is the headline; "only you" is not news a user can act on.
    expect(button.textContent).toBe("This Mac");
    expect(button.getAttribute("aria-label")).toBe("This Mac. Only you can reach this project");
    expect(button.dataset.reachEmphasis).toBeUndefined();
    expect(container.querySelector(".desktop-project-reach-count")).toBeNull();
    expect(container.querySelector(".desktop-project-reach-marks")).toBeNull();
    expect(button.querySelector('[data-reach-place="this-device"]')).not.toBeNull();
  });

  it("states a Cloud workspace as the place, in the Header's established words", async () => {
    const button = await renderControl({ state: state({ share: "published", place: "cloud" }) });
    expect(button.textContent).toBe("Cloud Computer");
    expect(button.getAttribute("aria-label")).toBe("Cloud Computer. Only you can reach this project");
    expect(button.querySelector('[data-reach-place="cloud"]')).not.toBeNull();
    const panel = openPanel();
    expect(panel.querySelector('.desktop-project-reach-card[data-reach-place="cloud"]')).not.toBeNull();
  });

  it("shows the machine the project is sitting on, beside what that means", async () => {
    await renderControl({
      state: state({ share: "published" }), onInvitePerson: noOp, onConnectAgent: noOp,
    });
    const panel = openPanel();
    const card = panel.querySelector(".desktop-project-reach-card");
    expect(card?.textContent).toBe("Only you can reach this project");
    // The drawing is the point: it says the project is spending this machine.
    expect(card?.querySelector('[data-reach-place="this-device"]')).not.toBeNull();
    // And it is the filled weight. The control that opened this panel is
    // already showing the same machine as an outline, because that is what
    // the titlebar's labels are made of; drawing an outline here too makes
    // the card a dimmer reprint of a label instead of the hardware itself.
    expect(card?.querySelector('[data-reach-tone="solid"]')).not.toBeNull();
    expect(container.querySelector<HTMLElement>('.desktop-titlebar-workspace-mark')?.dataset.reachTone).toBe("outline");
    // The card states, the rows act. Anything built out of a row's parts
    // reads as the row the user has just pressed, so it may not have any.
    expect(card?.querySelector(".desktop-menu-item")).toBeNull();
    expect(card?.closest("button")).toBeNull();
    expect(action("Invite a person")).not.toBeNull();
    expect(action("Connect an agent")).not.toBeNull();
  });

  it("keeps the place control about the place once somebody can reach it", async () => {
    const button = await renderControl({
      state: state({
        share: "shared",
        shares: [
          { id: "1", name: "A person", lastSeenAt: new Date(Date.now() - 14 * 60_000).toISOString() },
          { id: "2", name: "Viktor" },
        ],
      }),
    });
    expect(button.textContent).toBe("This Mac");
    expect(button.getAttribute("aria-label")).toBe("This Mac. 2 others can reach this project");
    // Who can reach it is stated on the right of the Header, with the people.
    expect(container.querySelector(".desktop-project-reach-mark")).toBeNull();
    expect(button.dataset.reachEmphasis).toBeUndefined();
  });

  it("states who can reach it on the right, with round people and square machines", async () => {
    await render(<ProjectReachPeople state={state({
      share: "shared",
      shares: [
        { id: "1", name: "A person", lastSeenAt: new Date(Date.now() - 14 * 60_000).toISOString() },
        { id: "2", name: "Viktor" },
      ],
    })} />);
    const people = container.querySelector<HTMLButtonElement>(".desktop-titlebar-reach-people")!;
    expect(people.getAttribute("aria-label")).toBe("2 others can reach this project");
    const marks = [...people.querySelectorAll(".desktop-project-reach-mark")];
    expect(marks.map((mark) => mark.getAttribute("data-reach-audience"))).toEqual(["person", "machine"]);
    // An agent is its brand; a person is the initial of the name we were given.
    expect(marks[1]?.getAttribute("data-reach-brand")).toBe("viktor");
    expect(marks[0]?.textContent).toBe("A");
  });

  it("shows nobody, and no pitch, when nobody can reach the project", async () => {
    await render(<ProjectReachPeople state={state({ share: "published" })} onInvitePerson={noOp} />);
    expect(container.querySelector(".desktop-titlebar-reach-people")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("counts the people it could not show, and opens the same panel", async () => {
    await render(<ProjectReachPeople
      state={state({
        share: "shared",
        shares: [
          { id: "1", name: "A person" }, { id: "2", name: "Viktor" },
          { id: "3", name: "Claude" }, { id: "4", name: "ChatGPT" },
        ],
      })}
      onInvitePerson={noOp}
      onConnectAgent={noOp}
    />);
    const people = container.querySelector<HTMLButtonElement>(".desktop-titlebar-reach-people")!;
    expect(people.querySelectorAll(".desktop-project-reach-mark")).toHaveLength(3);
    expect(people.querySelector(".desktop-project-reach-count")?.textContent).toBe("+1");
    act(() => people.click());
    const panel = document.querySelector(".desktop-project-reach-panel");
    expect(panel?.querySelector(".desktop-project-reach-card-reach")?.textContent)
      .toBe("4 others can reach this project");
    expect(action("Invite a person")).not.toBeNull();
  });

  it("keeps waiting for a first read as a statement about the destination", async () => {
    const button = await renderControl({
      state: state({ share: "waiting", shares: [{ id: "1", name: "Viktor" }], waitingFor: "Viktor" }),
    });
    expect(button.getAttribute("aria-label")).toContain("Waiting for");
    expect(button.getAttribute("aria-label")).toContain("Viktor");
    expect(button.dataset.reachEmphasis).toBeUndefined();
  });

  it("states activity while an agent is working, and lights the working destination", async () => {
    const working = state({
      share: "shared",
      shares: [{ id: "1", name: "A person" }, { id: "2", name: "Viktor" }],
      activity: { "2": { kind: "writing", label: "Viktor" } },
    });
    const button = await renderControl({ state: working });
    expect(button.getAttribute("aria-label")).toContain("is working in this project right now");

    await render(<ProjectReachPeople state={working} />);
    const marks = [...container.querySelectorAll(".desktop-project-reach-mark")];
    // Whoever is working comes first: it is the only live fact in the row.
    expect(marks[0]?.getAttribute("data-reach-activity")).toBe("writing");
    expect(marks[1]?.getAttribute("data-reach-activity")).toBeNull();
  });

  it("emphasizes reach that needs attention, and nothing else", async () => {
    const attention = await renderControl({ state: state({ share: "attention" }) });
    expect(attention.dataset.reachEmphasis).toBe("true");
    expect(attention.getAttribute("aria-label")).toBe("This Mac. This project cannot be reached right now");
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
    // No working copy here means the project is somewhere else, and the place
    // mark says so without the user picking a location.
    expect(button.getAttribute("aria-label")).toBe("Cloud Computer. This project is not on this Mac yet");
    expect(button.querySelector('[data-reach-place="cloud"]')).not.toBeNull();
    const panel = openPanel();
    expect(panel.querySelector('[data-testid="readers"]')).toBeNull();
    // The card is one statement in every state; a consequence that exists
    // only because of an obstacle sits beside the way out of it instead.
    expect(panel.querySelector(".desktop-project-reach-card")?.textContent)
      .toBe("This project is not on this Mac yet");
    expect(panel.querySelector(".desktop-project-reach-detail")?.textContent)
      .toBe("You can read this project as it is. Changing it needs a copy of it here.");
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

  /** Each computer row as [computer, name, second line, trailing], in panel order. */
  const computers = (panel: Element) => [...panel.querySelectorAll<HTMLButtonElement>(".desktop-project-computer")]
    .map((row) => [
      row.dataset.projectComputer,
      row.querySelector(".desktop-menu-item-label")?.textContent,
      row.querySelector(".desktop-menu-item-detail")?.textContent ?? null,
      row.querySelector(".desktop-menu-item-trailing")?.textContent ?? null,
    ]);
  const computer = (panel: Element, kind: "local" | "cloud") =>
    panel.querySelector<HTMLButtonElement>(`.desktop-project-computer[data-project-computer="${kind}"]`)!;

  it("lists the project's two computers, marks the current one, and switches from the other", async () => {
    const onCloud = vi.fn();
    await render(<DesktopTitlebarContext {...projectProps} projectReach={reach}
      projectLocation={{ current: "local", localAvailable: true, cloudState: "available" }}
      cloudProject={{ id: "project-1" }} onViewLocal={noOp} onViewCloud={onCloud} />);
    const panel = openPanel();
    // One project, two computers, in one group above who can reach it.
    expect(panel.firstElementChild?.className).toBe("desktop-project-computers");
    expect(computers(panel)).toEqual([
      ["local", "This Mac", null, ""],
      ["cloud", "Cloud Computer", null, "Switch"],
    ]);
    const mac = computer(panel, "local");
    expect(mac.getAttribute("aria-current")).toBe("true");
    expect(mac.classList.contains("selected")).toBe(true);
    expect(mac.querySelector(".lucide-check")).not.toBeNull();
    // The current computer is a fact, not an action.
    expect(mac.getAttribute("aria-disabled")).toBe("true");
    expect(panel.querySelector(".desktop-project-reach-card")).toBeNull();
    act(() => computer(panel, "cloud").click());
    expect(onCloud).toHaveBeenCalledOnce();
    expect(document.querySelector(".desktop-project-reach-menu")).toBeNull();
  });

  it("explains the Cloud Computer once, on the row that sets it up", async () => {
    const onCloud = vi.fn();
    await render(<DesktopTitlebarContext {...projectProps} projectReach={reach}
      projectLocation={{ current: "local", localAvailable: true, cloudState: "unavailable" }}
      onViewLocal={noOp} onViewCloud={onCloud} />);
    const panel = openPanel();
    expect(computers(panel)[1]).toEqual(["cloud", "Cloud Computer", "Agents keep working when this Mac is off.", "Set up"]);
    // The only sentence in the group, and only in this state.
    expect(panel.querySelectorAll(".desktop-project-computers .desktop-menu-item-detail")).toHaveLength(1);
    act(() => computer(panel, "cloud").click());
    expect(onCloud).toHaveBeenCalledOnce();
  });

  it("asks for sign-in on the Cloud Computer row when signed out", async () => {
    await render(<DesktopTitlebarContext {...projectProps} projectReach={reach}
      projectLocation={{ current: "local", localAvailable: true, cloudState: "signed-out" }}
      cloudProject={{ id: "project-1" }} onViewLocal={noOp} onViewCloud={noOp} />);
    expect(computers(openPanel())[1]).toEqual(["cloud", "Cloud Computer", null, "Sign in"]);
  });

  const button = () => container.querySelector<HTMLButtonElement>(".desktop-titlebar-reach-button")!;

  it("names the computer the screen moved to at once, with a spinner until it is ready", async () => {
    const onLocal = vi.fn();
    await render(<DesktopTitlebarContext {...projectProps} projectReach={reach}
      projectLocation={{ current: "local", requested: "cloud", headerLocation: "cloud", loading: true, localAvailable: true, cloudState: "available" }}
      onViewLocal={onLocal} onViewCloud={noOp} />);
    // The tint and the loading surface are the Cloud Computer's, so the name is too.
    expect(button().textContent).toBe("Cloud Computer");
    expect(button().getAttribute("aria-busy")).toBe("true");
    expect(button().querySelector(".lucide-loader-circle.animate-spin")).not.toBeNull();
    expect(button().querySelector(".desktop-cloud-icon, .lucide-laptop")).toBeNull();
    expect(button().getAttribute("aria-label")).toMatch(/^Opening Cloud Computer\. /);
    expect(button().closest("[data-tooltip]")?.getAttribute("data-tooltip")).toBe("Opening Cloud Computer");
    const panel = openPanel();
    expect(computers(panel)).toEqual([
      ["local", "This Mac", null, "Switch"],
      ["cloud", "Cloud Computer", "Opening…", null],
    ]);
    const cloud = computer(panel, "cloud");
    expect([cloud.getAttribute("aria-current"), cloud.getAttribute("aria-busy"), cloud.getAttribute("aria-disabled")])
      .toEqual(["true", "true", "true"]);
    expect(cloud.classList.contains("selected")).toBe(true);
    expect(cloud.querySelector(".lucide-loader-circle")).not.toBeNull();
    expect(cloud.querySelector(".lucide-check")).toBeNull();
    // Going back is the other computer's row.
    act(() => computer(panel, "local").click());
    expect(onLocal).toHaveBeenCalledOnce();
  });

  it("keeps the name and shows a warning when the computer could not be opened", async () => {
    const onLocal = vi.fn();
    await render(<DesktopTitlebarContext {...projectProps} projectReach={reach}
      projectLocation={{ current: "local", requested: "cloud", headerLocation: "cloud", failed: true, localAvailable: true, cloudState: "available" }}
      onViewLocal={onLocal} onViewCloud={noOp} />);
    expect(button().textContent).toBe("Cloud Computer");
    expect(button().hasAttribute("aria-busy")).toBe(false);
    expect(button().querySelector(".lucide-triangle-alert")).not.toBeNull();
    expect(button().getAttribute("data-computer-status")).toBe("failed");
    expect(button().getAttribute("aria-label")).toMatch(/^Couldn’t open Cloud Computer\. /);
    const panel = openPanel();
    // The screen owns retrying; the row only states it.
    expect(computers(panel)).toEqual([
      ["local", "This Mac", null, "Switch"],
      ["cloud", "Cloud Computer", "Couldn’t open", null],
    ]);
    expect(computer(panel, "cloud").getAttribute("aria-disabled")).toBe("true");
    expect(computer(panel, "cloud").querySelector(".lucide-triangle-alert")).not.toBeNull();
    act(() => computer(panel, "local").click());
    expect(onLocal).toHaveBeenCalledOnce();
  });

  it("keeps the user's computer while a destination waits behind sign-in or setup, and lets them cancel", async () => {
    const onLocal = vi.fn();
    await render(<DesktopTitlebarContext {...projectProps} projectReach={reach}
      projectLocation={{ current: "local", requested: "cloud", headerLocation: "local", loading: true, localAvailable: true, cloudState: "available" }}
      onViewLocal={onLocal} onViewCloud={noOp} />);
    // The screen has not moved, so neither has the name.
    expect(button().textContent).toBe("This Mac");
    expect(button().querySelector(".lucide-loader-circle")).toBeNull();
    const panel = openPanel();
    expect(computers(panel)).toEqual([
      ["local", "This Mac", null, ""],
      ["cloud", "Cloud Computer", "Opening…", "Cancel"],
    ]);
    expect(computer(panel, "local").getAttribute("aria-current")).toBe("true");
    expect(computer(panel, "cloud").getAttribute("aria-busy")).toBe("true");
    // Cancelling is staying on the computer the project is already on.
    act(() => computer(panel, "cloud").click());
    expect(onLocal).toHaveBeenCalledOnce();
  });

  it("marks the Cloud Computer as current, and a Mac the project is not on yet as unavailable", async () => {
    await render(<DesktopTitlebarContext {...projectProps} projectReach={reach}
      projectLocation={{ current: "cloud", localAvailable: false, cloudState: "available" }} onViewLocal={noOp} />);
    expect(container.querySelector(".desktop-titlebar-reach-button")?.textContent).toBe("Cloud Computer");
    expect(container.querySelector(".desktop-titlebar-reach-button .desktop-cloud-icon")).not.toBeNull();
    const panel = openPanel();
    expect(computers(panel)).toEqual([
      ["local", "This Mac", "Not on this Mac yet", null],
      ["cloud", "Cloud Computer", null, ""],
    ]);
    expect(computer(panel, "local").getAttribute("aria-disabled")).toBe("true");
    expect(computer(panel, "cloud").getAttribute("aria-current")).toBe("true");
  });

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
