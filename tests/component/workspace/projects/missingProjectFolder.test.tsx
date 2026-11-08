/** @vitest-environment happy-dom */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectFolderNotices, useFolderRelocation } from "../../../../src/features/app-shell/folder-availability";
import type { FolderLocateResult, FolderRelocation, FolderStatus } from "../../../../src/types/electron";
import { installDesktopBridge } from "../../../support/electron/desktopBridge";
import { HomeWithEntryFlow } from "../../../support/react/homeWithEntryFlow";
import { withTestLocalization } from "../../../support/react/localization";
import { accessibleName, getByRole, queryAllByRole, queryByRole, readableText } from "../../../support/react/queries";
import { createTestSurfaceAppearance } from "../../../support/react/surfaceAppearance";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); });

async function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(withTestLocalization(<>{node}</>)));
  return host;
}

const GONE = "/Users/me/Documents/PuppyOne/大使计划/大使计划A";
const missing: FolderStatus = { path: GONE, state: "missing" };

describe("a window folder that cannot be opened now", () => {
  const handlers = () => ({ onUseFound: vi.fn(), onLocate: vi.fn(), onRemove: vi.fn(), onRetry: vi.fn() });
  const buttons = (host: HTMLElement) => queryAllByRole(host, "button").map(accessibleName);

  it("says where it was and what may have happened, with finding it or removing it", async () => {
    const on = handlers();
    const host = await mount(<ProjectFolderNotices statuses={[missing]} removeLabel="project" busy={false} {...on} />);
    expect(readableText(getByRole(host, "status"))).toContain(
      "Can’t find “大使计划A”. It was in ~/Documents/PuppyOne/大使计划 and may have been moved, renamed or deleted.");
    expect(buttons(host)).toEqual(["Find it…", "Remove from project"]);
    await act(async () => getByRole(host, "button", { name: "Find it…" }).click());
    expect(on.onLocate).toHaveBeenCalledExactlyOnceWith(GONE);
    await act(async () => getByRole(host, "button", { name: "Remove from project" }).click());
    expect(on.onRemove).toHaveBeenCalledExactlyOnceWith(GONE);
  });

  it("offers the folder found renamed where it was, in one step", async () => {
    const on = handlers();
    const found = { token: "t-1", path: "/Users/me/Documents/PuppyOne/大使计划/大使计划B", name: "大使计划B", match: "same-folder" as const };
    const host = await mount(<ProjectFolderNotices statuses={[{ ...missing, suggestion: found }]} removeLabel="list" busy={false} {...on} />);
    expect(readableText(getByRole(host, "status"))).toContain("“大使计划A” is now called “大使计划B”.");
    expect(buttons(host)).toEqual(["Use “大使计划B”", "Find it…"]);
    await act(async () => getByRole(host, "button", { name: "Use “大使计划B”" }).click());
    expect(on.onUseFound).toHaveBeenCalledExactlyOnceWith(found);
  });

  it("never offers removal for a folder whose disk is merely away", async () => {
    const on = handlers();
    const host = await mount(<ProjectFolderNotices statuses={[{ path: "/Volumes/Work/Plans", state: "disconnected" }]}
      removeLabel="project" busy={false} {...on} />);
    expect(readableText(getByRole(host, "status"))).toContain("“Plans” is on a disk that isn’t connected.");
    expect(buttons(host)).toEqual(["Retry"]);
  });
});

describe("finding where a project's folder went", () => {
  function Flow({ onRelocated, onShareAgain }: { onRelocated: (relocation: FolderRelocation) => void; onShareAgain?: (path: string) => void }) {
    const relocation = useFolderRelocation({ onRelocated, onShareAgain });
    const [, rerender] = useState(0);
    return <>
      <button type="button" onClick={() => { void relocation.locate(GONE).then(() => rerender((n) => n + 1)); }}>Find it…</button>
      {relocation.dialog}
    </>;
  }
  const relocated: FolderRelocation = { from: GONE, path: "/Users/me/Elsewhere/大使计划A", wasShared: false };
  const chosen = (match: "same-folder" | "different"): FolderLocateResult => ({
    status: "selected", token: "t-2", path: relocated.path, name: "大使计划A", match });

  it("uses the very same folder at once", async () => {
    const relocateFolder = vi.fn(async () => relocated);
    installDesktopBridge({ locateFolder: async () => chosen("same-folder"), relocateFolder } as never);
    const onRelocated = vi.fn();
    const host = await mount(<Flow onRelocated={onRelocated} />);
    await act(async () => getByRole(host, "button", { name: "Find it…" }).click());
    await vi.waitFor(() => expect(onRelocated).toHaveBeenCalledExactlyOnceWith(relocated));
    expect(relocateFolder).toHaveBeenCalledExactlyOnceWith("t-2");
    expect(queryByRole(document, "dialog")).toBeNull();
  });

  it("asks before using a folder that does not look like the same one", async () => {
    const relocateFolder = vi.fn(async () => relocated);
    installDesktopBridge({ locateFolder: async () => chosen("different"), relocateFolder } as never);
    const onRelocated = vi.fn();
    const host = await mount(<Flow onRelocated={onRelocated} />);
    await act(async () => getByRole(host, "button", { name: "Find it…" }).click());
    const dialog = await vi.waitFor(() => getByRole(document, "dialog", { name: "Use this folder for “大使计划A”?" }));
    expect(relocateFolder).not.toHaveBeenCalled();
    await act(async () => getByRole(dialog, "button", { name: "Use this folder" }).click());
    await vi.waitFor(() => expect(onRelocated).toHaveBeenCalledOnce());
  });

  it("offers a shared project to the other computers again, through the ordinary Turn on", async () => {
    installDesktopBridge({ locateFolder: async () => chosen("same-folder"),
      relocateFolder: async () => ({ ...relocated, wasShared: true }) } as never);
    const onShareAgain = vi.fn();
    const host = await mount(<Flow onRelocated={vi.fn()} onShareAgain={onShareAgain} />);
    await act(async () => getByRole(host, "button", { name: "Find it…" }).click());
    const dialog = await vi.waitFor(() => getByRole(document, "dialog", { name: "Open it to your other computers again?" }));
    expect(onShareAgain).not.toHaveBeenCalled();
    await act(async () => getByRole(dialog, "button", { name: "Turn on" }).click());
    expect(onShareAgain).toHaveBeenCalledExactlyOnceWith(relocated.path);
  });
});

describe("a project on the Homepage whose folder cannot be opened now", () => {
  const items = [
    { id: "gone", label: "大使计划A", localPath: GONE },
    { id: "here", label: "Notes", localPath: "/Users/me/Notes" },
  ];

  it("says so under its name and asks instead of opening it", async () => {
    const onOpenWorkspacePath = vi.fn(async () => {});
    const onOpenUnavailableProject = vi.fn();
    const host = await mount(<HomeWithEntryFlow appearance={createTestSurfaceAppearance()} projectItems={items}
      unavailableProjects={new Map([[GONE, "Can’t find"]])} onOpenUnavailableProject={onOpenUnavailableProject}
      onChooseWorkspace={async () => {}} onOpenWorkspacePath={onOpenWorkspacePath} onOpenDroppedWorkspace={async () => {}} />);
    const gone = getByRole(host, "button", { name: "Open 大使计划A locally" });
    expect(readableText(gone)).toContain("Can’t find");
    expect(gone.getAttribute("aria-description")).toBe("Can’t find");
    expect(gone.getAttribute("draggable")).toBe("false");
    await act(async () => gone.click());
    expect(onOpenUnavailableProject).toHaveBeenCalledExactlyOnceWith(GONE);
    expect(onOpenWorkspacePath).not.toHaveBeenCalled();
    // A project that is there opens as before.
    expect(readableText(getByRole(host, "button", { name: "Open Notes locally" }))).not.toContain("Can’t find");
  });
});
