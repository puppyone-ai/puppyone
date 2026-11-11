import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/features/cloud/styles/sidebar-shell.css", "utf8");
const block = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`missing rule ${selector}`);
  return css.slice(start, css.indexOf("}", start) + 1);
};

/** How a Cloud project's loading state sits on its page; what it says is the component test's. */
describe("Cloud loading state layout", () => {
  it("centers against the full Cloud main surface", () => {
    const main = block(".desktop-cloud-main-view");
    const loading = block(".desktop-cloud-loading-state");

    expect(main).toContain("position: relative;");
    expect(loading).toContain("position: absolute;");
    expect(loading).toContain("inset: 0;");
    expect(loading).toContain("width: 100%;");
    expect(loading).toContain("height: 100%;");
    expect(loading).toContain("place-items: center;");
  });
});
