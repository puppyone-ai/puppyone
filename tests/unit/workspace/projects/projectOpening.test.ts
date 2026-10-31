import { describe, expect, it } from "vitest";
import { openingLocalProjectName } from "../../../../src/features/app-shell/projectOpening";

const projectItems = [{ label: "Renamed notes", localPath: "/work/notes" }, { label: "", localPath: "/work/unnamed" }];
const resolve = (pending: Parameters<typeof openingLocalProjectName>[0]["pending"], droppedProjectName: string | null = null) =>
  openingLocalProjectName({ pending, droppedProjectName, projectItems });

describe("the local project a window is entering", () => {
  it("names a chosen project as the Homepage names it", () => {
    expect(resolve({ kind: "local", path: "/work/notes" })).toBe("Renamed notes");
  });

  it("falls back to the folder when the catalog has no name for it", () => {
    expect(resolve({ kind: "local", path: "/work/unnamed" })).toBe("unnamed");
    expect(resolve({ kind: "local", path: "/work/elsewhere/" })).toBe("elsewhere");
    expect(resolve({ kind: "local", path: "C:\\work\\windows" })).toBe("windows");
  });

  it("names a dropped folder, which is not a navigation target or in the catalog yet", () => {
    expect(resolve(null, "Dropped")).toBe("Dropped");
  });

  it("is nothing while no local project is on its way", () => {
    expect(resolve(null)).toBeNull();
    expect(resolve({ kind: "cloud", projectId: "a" })).toBeNull();
  });
});
