import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  it("recognizes a brand however an Agent writes its name", () => {
    for (const [label, brandId] of [
      ["Grok Bot", "grok-bot"],
      ["grok-bot", "grok-bot"],
      ["GROK_BOT", "grok-bot"],
      ["Grok", "grok-bot"],
      ["xAI Grok CLI", "grok-bot"],
      ["GitHub Copilot", "github-copilot"],
      ["github-copilot", "github-copilot"],
      ["Microsoft Copilot Studio", "copilot-studio"],
      ["Built-in Agent", "built-in-agent"],
      ["Claude Code", "claude"],
    ] as const) expect(resolveAgentBrand({ label })?.id, label).toBe(brandId);
  });

  it("gives a mark that cannot inherit the page's color an asset for each theme", () => {
    // An <img> resolves currentColor to black, which is invisible on a dark surface.
    const source = (path: string) => readFileSync(resolve(process.cwd(), "public", path), "utf8");
    for (const brandId of AGENT_BRAND_IDS) {
      const { light, dark } = AGENT_BRAND_CATALOG[brandId].assets;
      if (!light.endsWith(".svg") || !source(light).includes("currentColor")) continue;
      expect(dark, brandId).toBeDefined();
      expect(source(dark!), brandId).not.toContain("currentColor");
    }
  });

  it("claims no brand from part of a word or from a word two brands share", () => {
    for (const label of ["Groq", "Grokking Notes", "Copilot", "GitHub", "Research helper", "我的小助手"]) {
      expect(resolveAgentBrand({ label }), label).toBeNull();
    }
  });

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
    expect(AGENT_BRAND_CATALOG.codex.assets).toEqual(AGENT_BRAND_CATALOG.chatgpt.assets);
  });

  it("renders both Codex and ChatGPT identities with the ChatGPT monochrome mark", () => {
    for (const brandId of ["codex", "chatgpt"] as const) {
      const markup = renderToStaticMarkup(<AgentMonochromeBrandImage brandId={brandId} />);

      expect(markup).toContain("assets/icons/agents/chatgpt.png");
      expect(markup).toContain('fill="currentColor"');
      expect(markup).not.toContain("codex-light.png");
      expect(markup).not.toContain("codex-dark.png");
    }

    const imageMarkup = renderToStaticMarkup(<AgentBrandImage brandId="codex" />);
    expect(imageMarkup).toContain("assets/icons/agents/chatgpt.png");
    expect(imageMarkup).not.toContain("codex-light.png");
  });

  it("resolves runtime aliases without confusing Pi with ordinary words", () => {
    expect(resolveAgentBrand({ id: "claude-code" })?.id).toBe("claude");
    expect(resolveAgentBrand({ id: "cursor-cli" })?.id).toBe("cursor");
    expect(resolveAgentBrand({ iconKey: "openai", label: "Codex session" })?.id).toBe("codex");
    expect(resolveAgentBrand({ label: "Pi Agent" })?.id).toBe("pi");
    expect(resolveAgentBrand({ id: "workbuddy" })?.id).toBe("workbuddy");
    expect(resolveAgentBrand({ id: "workbuddy-china" })?.id).toBe("workbuddy");
    expect(resolveAgentBrand({ id: "workbuddy-international" })?.id).toBe("workbuddy");
    expect(resolveAgentBrand({ label: "CodeBuddy session" })?.id).toBe("workbuddy");
    expect(resolveAgentBrand({ id: "puppyone-agent", iconKey: "built-in-agent" })?.id)
      .toBe("built-in-agent");
    expect(getAgentBrand("workspace-agent")?.id).toBe("built-in-agent");
    expect(resolveAgentBrand({ label: "API session" })).toBeNull();
    expect(getAgentBrand("PI")?.displayName).toBe("Pi Agent");
  });

  it("renders Built-in Agent with its own themed mark instead of the PuppyOne product mark", () => {
    const markup = renderToStaticMarkup(<AgentBrandImage brandId="built-in-agent" />);

    expect(markup.match(/<img/g)).toHaveLength(2);
    expect(markup).toContain("assets/icons/agents/built-in-agent.svg");
    expect(markup).toContain("assets/icons/agents/built-in-agent-dark.svg");
    expect(markup).not.toContain("assets/brand/puppy/");
  });

  it("renders WorkBuddy with the supplied local color mark", () => {
    const markup = renderToStaticMarkup(<AgentBrandImage brandId="workbuddy" />);

    expect(markup.match(/<img/g)).toHaveLength(1);
    expect(markup).toContain("assets/icons/agents/workbuddy.png");
    expect(markup).toContain('alt=""');
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
