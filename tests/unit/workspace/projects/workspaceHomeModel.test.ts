import { describe, expect, it } from "vitest";
import { getWorkspaceParentPathForDisplay } from "../../../../src/features/app-shell/workspaceHomeModel";

describe("desktop workspace display path", () => {
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
