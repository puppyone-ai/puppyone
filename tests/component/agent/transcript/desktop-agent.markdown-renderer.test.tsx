/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SafeMarkdown } from "../../../../src/features/desktop-agent/ui/SafeMarkdown";
import {
  createAgentMarkdownBlockRegistry,
  type AgentMarkdownRichBlockProps,
} from "../../../../src/features/desktop-agent/ui/markdown/agentMarkdownBlockRegistry";
import { AgentMarkdownEnvironmentProvider } from "../../../../src/features/desktop-agent/ui/markdown/AgentMarkdownEnvironment";
import { withTestLocalization } from "../../../support/react/localization";

const mermaidMocks = vi.hoisted(() => ({
  render: vi.fn(async () => ({ svg: "<svg><text>diagram</text></svg>", cacheKey: "agent", themeKey: "theme" })),
  mount: vi.fn((host: HTMLElement) => {
    const element = document.createElement("span");
    element.className = "test-safe-mermaid";
    host.replaceChildren(element);
    return { element, dispose: () => element.remove() };
  }),
  subscribe: vi.fn(() => () => undefined),
}));

vi.mock("@puppyone/shared-ui", async (importOriginal) => ({
  ...await importOriginal<typeof import("@puppyone/shared-ui")>(),
  getMermaidThemeSnapshot: () => ({ key: "theme", config: {} }),
  mountSanitizedMermaidSvg: mermaidMocks.mount,
  renderMermaidDiagram: mermaidMocks.render,
  subscribeMermaidThemeChanges: mermaidMocks.subscribe,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("Agent Markdown renderer", () => {
  it("uses the message language for locale-aware reading typography", () => {
    const container = render("用户访谈已经完成，接下来修复编辑器问题。");

    expect(container.querySelector(".desktop-agent-markdown")?.getAttribute("lang"))
      .toBe("zh-Hans");
  });

  it("renders semantic GFM tables inside a bounded horizontal viewport", () => {
    const container = render([
      "| Level | Action | Meaning |",
      "| :--- | :---: | ---: |",
      "| 1 | Read | Distribute |",
      "| 2 | Open | Activate |",
    ].join("\n"));
    const viewport = container.querySelector<HTMLElement>(".desktop-agent-markdown-table-scroll");
    const table = viewport?.querySelector("table");
    expect(viewport?.tabIndex).toBe(0);
    expect(table?.querySelectorAll("thead th")).toHaveLength(3);
    expect(table?.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(table?.querySelector<HTMLElement>("thead th")?.style.textAlign).toBe("left");
    expect(table?.textContent).toContain("Activate");
  });

  it("supports task lists, nested lists, strikethrough, autolinks, rules, and footnotes", () => {
    const container = render([
      "- [x] Done",
      "- [ ] Next",
      "  - Nested",
      "",
      "~~obsolete~~",
      "",
      "https://example.com",
      "",
      "---",
      "",
      "Note[^1]",
      "",
      "[^1]: Detail",
    ].join("\n"));
    const tasks = container.querySelectorAll<HTMLInputElement>('.task-list-item input[type="checkbox"]');
    expect(tasks).toHaveLength(2);
    expect(tasks[0].disabled).toBe(true);
    expect(tasks[0].checked).toBe(true);
    expect(container.querySelector("li li")?.textContent).toContain("Nested");
    expect(container.querySelector("del")?.textContent).toBe("obsolete");
    expect(container.querySelector('a[href="https://example.com/"]')).not.toBeNull();
    expect(container.querySelector("hr")).not.toBeNull();
    expect(container.querySelector("[data-footnotes]")?.textContent).toContain("Detail");
  });

  it("keeps raw HTML inert, rejects unsafe links, and never auto-loads assistant images", () => {
    const container = render([
      "<script>window.pwned = true</script>",
      "",
      "[unsafe](javascript:alert(1))",
      "",
      "![tracking pixel](https://tracker.example/pixel.png)",
    ].join("\n"));
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>");
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[role="img"]')?.textContent).toContain("tracking pixel");
  });

  it("delegates safe external navigation to the host capability", async () => {
    const openExternalUrl = vi.fn();
    const container = render("[Docs](https://example.com/guide)", undefined, openExternalUrl);
    const link = container.querySelector<HTMLAnchorElement>("a");
    expect(link?.target).toBe("_blank");
    await act(async () => {
      link?.click();
      await Promise.resolve();
    });
    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/guide");
  });

  it("does not navigate external links when the host capability is absent", () => {
    const container = render("[Docs](https://example.com/guide)");
    const link = container.querySelector<HTMLAnchorElement>("a");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => link?.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
  });

  it("resolves only explicitly registered rich blocks", () => {
    const CustomBlock = ({ source }: AgentMarkdownRichBlockProps) => <output data-custom-block>{source}</output>;
    const registry = createAgentMarkdownBlockRegistry([{ id: "custom", languages: ["custom"], component: CustomBlock }]);
    const container = render("```custom\nhello\n```", registry);
    expect(container.querySelector("[data-custom-block]")?.textContent).toBe("hello");
    expect(registry.resolve("CUSTOM")?.id).toBe("custom");
    expect(() => createAgentMarkdownBlockRegistry([
      { id: "one", languages: ["same"], component: CustomBlock },
      { id: "two", languages: ["same"], component: CustomBlock },
    ])).toThrow(/Duplicate Agent Markdown block language/);
  });

  it("lazy-renders a closed Mermaid fence through the shared safe mount", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const container = render("```mermaid\ngraph TD; A-->B\n```");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mermaidMocks.render).toHaveBeenCalledWith(expect.objectContaining({ source: "graph TD; A-->B" }));
    expect(mermaidMocks.mount).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".test-safe-mermaid")).not.toBeNull();
    expect(container.querySelector(".desktop-agent-mermaid.is-ready")).not.toBeNull();
  });
});

function render(
  text: string,
  blockRegistry?: ReturnType<typeof createAgentMarkdownBlockRegistry>,
  openExternalUrl?: (href: string) => void,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(withTestLocalization(
    <AgentMarkdownEnvironmentProvider openExternalUrl={openExternalUrl}>
      <SafeMarkdown text={text} blockRegistry={blockRegistry} />
    </AgentMarkdownEnvironmentProvider>,
  )));
  return container;
}
