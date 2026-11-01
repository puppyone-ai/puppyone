import { describe, expect, it } from "vitest";
import { getWorkspaceParentPathForDisplay, getWorkspacePathForDisplay, keepHydratedRecentItems } from "../../../../src/lib/workspaceHomeModel";

describe("desktop workspace display path", () => {
  it("abbreviates Mac home paths without removing the project or abbreviating external locations", () => {
    expect(getWorkspacePathForDisplay("/Users/example/project/demo")).toBe("~/project/demo");
    expect(getWorkspacePathForDisplay("/Users/example")).toBe("~");
    expect(getWorkspacePathForDisplay("/Volumes/Projects/demo")).toBe("/Volumes/Projects/demo");
    expect(getWorkspacePathForDisplay("C:\\Projects\\demo")).toBe("C:\\Projects\\demo");
  });

  it("shows the home-relative parent without repeating the project name", () => {
    expect(getWorkspaceParentPathForDisplay("/Users/example/Desktop/puppyone desktop"))
      .toBe("~/Desktop");
  });

  it("keeps non-home parent paths canonical", () => {
    expect(getWorkspaceParentPathForDisplay("/private/tmp/puppyone-project"))
      .toBe("/private/tmp");
  });

  it("handles trailing separators and filesystem roots", () => {
    expect(getWorkspaceParentPathForDisplay("/Users/example/Documents/demo/"))
      .toBe("~/Documents");
    expect(getWorkspaceParentPathForDisplay("/workspace"))
      .toBe("/");
  });
});

type RecentHomeItem = Parameters<typeof keepHydratedRecentItems>[0][number];

describe("keepHydratedRecentItems", () => {
  const light = (path: string, name = path) => ({ workspace: { id: path, name, path, status: "protected", hydrationState: "metadata" } }) as RecentHomeItem;
  const dated = (path: string) => ({ workspace: { ...light(path).workspace, hydrationState: "ready", lastModifiedAt: "2026-10-01T00:00:00Z", commitCount: 3 } }) as RecentHomeItem;

  it("keeps a project's dates through a re-read that has none", () => {
    const [kept] = keepHydratedRecentItems([light("/a")], [dated("/a")]);
    expect(kept?.workspace).toMatchObject({ lastModifiedAt: "2026-10-01T00:00:00Z", commitCount: 3, hydrationState: "ready" });
  });

  it("takes the re-read's name, order and any project it adds or drops", () => {
    const kept = keepHydratedRecentItems([light("/new"), light("/a", "Renamed")], [dated("/a"), dated("/gone")]);
    expect(kept.map(({ workspace }) => [workspace.path, workspace.name, workspace.hydrationState]))
      .toEqual([["/new", "/new", "metadata"], ["/a", "Renamed", "ready"]]);
  });

  it("lets a hydrated result replace what was known", () => {
    const fresher = { workspace: { ...dated("/a").workspace, lastModifiedAt: "2026-11-01T00:00:00Z" } };
    expect(keepHydratedRecentItems([fresher], [dated("/a")])[0]?.workspace.lastModifiedAt).toBe("2026-11-01T00:00:00Z");
  });
});
