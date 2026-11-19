import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Who is in a Cloud project is the component test's; how a working Agent moves is a style rule. */
describe("Agent presence motion", () => {
  it("stills a working Agent's mark for those who ask for less motion", () => {
    const styles = readFileSync("src/components/brand/agent-avatar.css", "utf8");
    const reduced = styles.slice(styles.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\[data-reach-activity\],\s+[^{]*\[data-reach-activity\]::before\s*\{\s*animation: none;/);
  });
});
