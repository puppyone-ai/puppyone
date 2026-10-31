import { describe, expect, it } from "vitest";
import { describeProjectOpening } from "../../../../src/features/app-shell/window-project/projectOpening";
import { projectMatchesTarget, sameProjectTarget } from "../../../../src/features/app-shell/window-project/projectNavigation";
import type { ProjectTarget } from "../../../../src/features/app-shell/window-project/windowProjectStore";

const projectItems = [
  { label: "Renamed notes", localPath: "/work/notes" },
  { label: "", localPath: "/work/unnamed" },
  { label: "Launch", localPath: "", cloudProjectId: "launch" },
];
const describeOpening = (opening: ProjectTarget | null, overrides: Partial<Parameters<typeof describeProjectOpening>[0]> = {}) =>
  describeProjectOpening({ opening, displayedPath: null, displayedCloudProjectId: null, projectItems, ...overrides });
const dropped = new File([], "Dropped");

describe("the project a window is entering", () => {
  it("names a chosen project as the Homepage names it, wherever it lives", () => {
    expect(describeOpening({ kind: "local", path: "/work/notes" })).toEqual({ location: "local", projectName: "Renamed notes" });
    expect(describeOpening({ kind: "cloud", projectId: "launch" })).toEqual({ location: "cloud", projectName: "Launch" });
  });

  it("falls back to the folder when the catalog has no name for it", () => {
    expect(describeOpening({ kind: "local", path: "/work/unnamed" })?.projectName).toBe("unnamed");
    expect(describeOpening({ kind: "local", path: "/work/elsewhere/" })?.projectName).toBe("elsewhere");
    expect(describeOpening({ kind: "local", path: "C:\\work\\windows" })?.projectName).toBe("windows");
  });

  it("uses what the Cloud has said about a project the catalog does not list", () => {
    expect(describeOpening({ kind: "cloud", projectId: "new" }, { preparedCloudProjectName: "Shared with me" })?.projectName).toBe("Shared with me");
    expect(describeOpening({ kind: "cloud", projectId: "new" })?.projectName).toBe("");
  });

  it("names a dropped folder, which is not in the catalog yet", () => {
    expect(describeOpening({ kind: "dropped", folder: dropped })).toEqual({ location: "local", projectName: "Dropped" });
  });

  it("is nothing while no project is on its way", () => {
    expect(describeOpening(null)).toBeNull();
  });

  it("does not cover the project on screen when it is chosen again", () => {
    expect(describeOpening({ kind: "local", path: "/work/notes" }, { displayedPath: "/work/notes" })).toBeNull();
    expect(describeOpening({ kind: "cloud", projectId: "launch" }, { displayedCloudProjectId: "launch" })).toBeNull();
  });

  it("is an open when the folder shares an id with nothing on screen", () => {
    expect(describeOpening({ kind: "cloud", projectId: "launch" }, { displayedPath: "/work/notes" })).not.toBeNull();
    expect(describeOpening({ kind: "local", path: "/work/notes" }, { displayedCloudProjectId: "launch" })).not.toBeNull();
  });
});

describe("project targets", () => {
  it("treats a dropped folder as the same target only when it is the same drop", () => {
    expect(sameProjectTarget({ kind: "dropped", folder: dropped }, { kind: "dropped", folder: dropped })).toBe(true);
    expect(sameProjectTarget({ kind: "dropped", folder: dropped }, { kind: "dropped", folder: new File([], "Dropped") })).toBe(false);
    expect(sameProjectTarget({ kind: "dropped", folder: dropped }, { kind: "local", path: "/work/notes" })).toBe(false);
  });

  it("never marks a catalog row as the target of a drop", () => {
    expect(projectMatchesTarget({ localPath: "/work/notes" }, { kind: "dropped", folder: dropped })).toBe(false);
    expect(projectMatchesTarget({ localPath: "/work/notes" }, null)).toBe(false);
  });
});
