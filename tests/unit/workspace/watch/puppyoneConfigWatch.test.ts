import { describe, expect, it } from "vitest";
import { isPuppyoneConfigEvent } from "../../../../src/features/app-shell/usePuppyoneConfig";

describe("PuppyOne config watcher filter", () => {
  it("recognizes atomic replace/create/delete events across platform separators", () => {
    expect(isPuppyoneConfigEvent(".puppyone/config.json")).toBe(true);
    expect(isPuppyoneConfigEvent(".puppyone\\config.json")).toBe(true);
    expect(isPuppyoneConfigEvent(".puppyone/.config.123.tmp")).toBe(true);
    expect(isPuppyoneConfigEvent(null)).toBe(true);
    expect(isPuppyoneConfigEvent("notes/readme.md")).toBe(false);
  });
});
