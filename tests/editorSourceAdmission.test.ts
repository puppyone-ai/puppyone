import { describe, expect, it } from "vitest";
import {
  exceedsUtf8ByteLimit,
  formatByteLimit,
} from "../packages/shared-ui/src/editor/host/sourceAdmission";

describe("Editor source admission", () => {
  it("counts UTF-8 bytes without allocating a second full-size buffer", () => {
    expect(exceedsUtf8ByteLimit("abcd", 4)).toBe(false);
    expect(exceedsUtf8ByteLimit("你好", 5)).toBe(true);
    expect(exceedsUtf8ByteLimit("😀", 4)).toBe(false);
    expect(exceedsUtf8ByteLimit("😀", 3)).toBe(true);
  });

  it("fails closed for invalid budgets", () => {
    expect(exceedsUtf8ByteLimit("", -1)).toBe(true);
    expect(exceedsUtf8ByteLimit("a", Number.NaN)).toBe(true);
  });

  it("formats manifest byte limits for the pane-local rejection state", () => {
    expect(formatByteLimit(8 * 1024 * 1024)).toBe("8 MB");
  });
});
