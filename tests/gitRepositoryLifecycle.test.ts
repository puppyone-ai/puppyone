import { describe, expect, it } from "vitest";
import {
  isGitStatusContextLoading,
  resolveActiveGitStatus,
} from "../src/features/source-control/useGitRepositoryLifecycle";
import type { GitStatusSnapshot } from "../src/types/electron";

describe("Git repository presentation lifecycle", () => {
  it("is synchronously pending when the rendered Project outruns the committed Git context", () => {
    expect(isGitStatusContextLoading("/project-b", "/project-a", false)).toBe(true);
    expect(isGitStatusContextLoading("/project-b", null, false)).toBe(true);
  });

  it("keeps cached metadata visible while its matching context revalidates", () => {
    expect(isGitStatusContextLoading("/project-b", "/project-b", false)).toBe(false);
    expect(isGitStatusContextLoading("/project-b", "/project-b", true)).toBe(true);
    expect(isGitStatusContextLoading(null, null, true)).toBe(false);
  });

  it("reuses per-Project Git metadata synchronously without coupling local files to the network", () => {
    const previousStatus = { branch: "previous" } as GitStatusSnapshot;
    const cachedStatus = { branch: "cached" } as GitStatusSnapshot;

    expect(resolveActiveGitStatus("/project-b", "/project-a", previousStatus, cachedStatus))
      .toBe(cachedStatus);
    expect(resolveActiveGitStatus("/project-b", "/project-b", previousStatus, cachedStatus))
      .toBe(previousStatus);
    expect(resolveActiveGitStatus("/project-c", "/project-b", previousStatus, null)).toBeNull();
    expect(resolveActiveGitStatus(null, "/project-b", previousStatus, cachedStatus)).toBeNull();
  });
});
