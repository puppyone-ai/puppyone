import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cascadeBootstrapPlugin } from "../../../../tooling/styles/cascade-bootstrap-plugin.mjs";

describe("renderer cascade bootstrap", () => {
  it("registers the canonical order ahead of extracted CSS in both dev and build", () => {
    const plugin = cascadeBootstrapPlugin();
    expect(plugin.apply).toBeUndefined();
    expect(plugin.transformIndexHtml.order).toBe("post");
    expect(plugin.transformIndexHtml.handler()).toEqual([{
      tag: "style",
      attrs: { "data-po-style-cascade": "" },
      children: readFileSync(new URL("../../../../src/styles/cascade.css", import.meta.url), "utf8"),
      injectTo: "head-prepend",
    }]);
  });

  it("keeps the bootstrap in the application build pipeline", () => {
    expect(readFileSync(new URL("../../../../vite.config.ts", import.meta.url), "utf8"))
      .toContain("react(), cascadeBootstrapPlugin(), desktopContentSecurityPolicyPlugin");
  });
});
