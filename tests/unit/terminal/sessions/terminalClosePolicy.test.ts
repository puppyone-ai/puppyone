import { describe, expect, it } from "vitest";
import { getTerminalClosePolicy } from "../../../../src/features/desktop-terminal/model/terminalClosePolicy";

describe("Terminal close policy", () => {
  it.each([
    ["selecting", "close"],
    ["starting", "confirm"],
    ["running", "confirm"],
    ["exited", "close"],
    ["error", "close"],
  ] as const)("maps %s sessions to %s", (status, expected) => {
    expect(getTerminalClosePolicy(status)).toBe(expected);
  });
});
