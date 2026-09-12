import { describe, expect, it } from "vitest";
import { terminalPathLabel } from "../../../../src/features/desktop-terminal/model/terminalPath";

describe("Terminal path labels", () => {
  it.each([
    ["/Users/test/my private", "my private"],
    ["/Users/test/my private/", "my private"],
    ["C:\\Users\\test\\workspace", "workspace"],
    ["C:\\Users\\test\\workspace\\", "workspace"],
    ["/", "/"],
    ["", "—"],
  ])("shows the leaf name for %s", (pathValue, expected) => {
    expect(terminalPathLabel(pathValue)).toBe(expected);
  });
});
