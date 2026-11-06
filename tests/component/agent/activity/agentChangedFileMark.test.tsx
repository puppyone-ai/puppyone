/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { TestLocalizationProvider } from "@puppyone/localization/testing";
import englishCatalog from "../../../../src/localization/catalog-loaders/en";
import { AgentChangedFileMark } from "../../../../src/features/desktop-agent-presence/AgentChangedFileMark";
import { agentChangedFilesStore as store } from "../../../../src/features/desktop-agent-presence/agentChangedFilesStore";
import { useAgentFileReview } from "../../../../src/features/desktop-agent-presence/useAgentFileReview";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); });
function mount(children: React.ReactNode) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root!.render(children));
}
function File({ project, ready }: { project: string; ready: boolean }) {
  useAgentFileReview(project, "src/a.md", ready); return <div>Document</div>;
}
describe("Agent unread file UI", () => {
  it("updates both file and parent markers, then clears only the viewed file", () => {
    const project = "/workspace/marks";
    mount(<TestLocalizationProvider messages={englishCatalog}><AgentChangedFileMark root={project} path="src/a.md" />
      <AgentChangedFileMark root={project} path="src" folder /></TestLocalizationProvider>);
    act(() => store.mark(project, ["src/a.md", "src/b.md"]));
    expect(document.querySelectorAll(".desktop-agent-changed-file-mark")).toHaveLength(2);
    expect(document.querySelector("[role=img]")?.getAttribute("aria-label")).toContain("Agent");
    act(() => store.acknowledge(project, "src/a.md"));
    expect(document.querySelectorAll(".desktop-agent-changed-file-mark")).toHaveLength(1);
    act(() => store.acknowledge(project, "src/b.md"));
    expect(document.querySelectorAll(".desktop-agent-changed-file-mark")).toHaveLength(0);
  });

  it("waits for content readiness and preserves edits arriving while a file is opening", () => {
    const project = "/workspace/opening";
    store.mark(project, ["src/a.md"]);
    mount(<File project={project} ready={false} />);
    expect(store.has(project, "src/a.md")).toBe(true);
    act(() => store.mark(project, ["src/a.md"]));
    act(() => root!.render(<File project={project} ready />));
    expect(store.has(project, "src/a.md")).toBe(true);
    act(() => store.requestReview(project, "src/a.md"));
    expect(store.has(project, "src/a.md")).toBe(false);
    act(() => store.mark(project, ["src/a.md"]));
    expect(store.has(project, "src/a.md")).toBe(true);
  });

  it("does not clear a requested review until the document has loaded successfully", () => {
    const project = "/workspace/unavailable";
    store.mark(project, ["src/a.md"]);
    mount(<File project={project} ready={false} />);
    act(() => store.requestReview(project, "src/a.md"));
    expect(store.has(project, "src/a.md")).toBe(true);
    act(() => root!.render(<File project={project} ready />));
    expect(store.has(project, "src/a.md")).toBe(false);
  });
});
