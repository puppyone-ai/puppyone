import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AGENT_BRAND_CATALOG,
  AGENT_BRAND_IDS,
  AgentBrandImage,
  AgentMonochromeBrandImage,
  MONOCHROME_AGENT_BRAND_IDS,
  getAgentBrand,
  resolveAgentBrand,
} from "@puppyone/shared-ui";

describe("Agent brand registry", () => {
  it("uses one canonical id and themed asset contract for every registered brand", () => {
    expect(Object.keys(AGENT_BRAND_CATALOG)).toEqual([...AGENT_BRAND_IDS]);

    for (const brandId of AGENT_BRAND_IDS) {
      const brand = AGENT_BRAND_CATALOG[brandId];
      expect(brand.id).toBe(brandId);
      expect(brand.displayName).not.toBe("");
      expect(brand.assetOpticalScale).toBeGreaterThan(0);
      expect(brand.assets.light).toMatch(/^assets\/icons\/agents\//);
      if (brand.assets.dark) expect(brand.assets.dark).toMatch(/^assets\/icons\/agents\//);
    }
  });

  it("resolves runtime aliases without confusing Pi with ordinary words", () => {
    expect(resolveAgentBrand({ id: "claude-code" })?.id).toBe("claude");
    expect(resolveAgentBrand({ id: "cursor-cli" })?.id).toBe("cursor");
    expect(resolveAgentBrand({ iconKey: "openai", label: "Codex session" })?.id).toBe("codex");
    expect(resolveAgentBrand({ label: "Pi Agent" })?.id).toBe("pi");
    expect(resolveAgentBrand({ label: "API session" })).toBeNull();
    expect(getAgentBrand("PI")?.displayName).toBe("Pi Agent");
  });

  it("renders Pi's existing light and dark repository marks", () => {
    const markup = renderToStaticMarkup(<AgentBrandImage brandId="pi" />);

    expect(markup.match(/<img/g)).toHaveLength(2);
    expect(markup).toContain("assets/icons/agents/pi.svg");
    expect(markup).toContain('data-agent-brand-theme="light"');
    expect(markup).toContain("assets/icons/agents/pi-dark.svg");
    expect(markup).toContain('data-agent-brand-theme="dark"');
    expect(markup).toContain("--po-agent-brand-image-scale:1.28");
  });

  it("renders Pi's normalized monochrome mark without the source asset's oversized safety area", () => {
    const markup = renderToStaticMarkup(<AgentMonochromeBrandImage brandId="pi" />);

    expect(markup).toContain('viewBox="150 150 500 500"');
    expect(markup).toContain('fill="currentColor"');
    expect(markup).not.toContain("<img");
  });

  it.each(MONOCHROME_AGENT_BRAND_IDS)(
    "renders %s as a current-color monochrome vector",
    (brandId) => {
      const markup = renderToStaticMarkup(
        <AgentMonochromeBrandImage brandId={brandId} />,
      );

      expect(markup).toContain("<svg");
      expect(markup).toContain('fill="currentColor"');
      expect(markup).toContain("po-agent-monochrome-brand-image");
      expect(markup).not.toContain("<img");
    },
  );
});
