/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataNode, DataPort, Workspace } from "../../../../../../packages/shared-ui/src/core/types";
import { DataWorkspace } from "../../../../../../packages/shared-ui/src/data/DataWorkspace";
import { withTestLocalization } from "../../../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const DOCUMENT_PATH = "Untitled.md";
const COMPONENT_SOURCE = [
  "<Tabs>",
  '  <Tab label="Tab 1">',
  "",
  "  first",
  "  </Tab>",
  "",
  '  <Tab label="Tab 2">',
  "",
  "  second",
  "  </Tab>",
  "</Tabs>",
].join("\n");

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("Workspace to Markdown dialect integration", () => {
  it("carries explicit OpenKnowledge metadata through DataWorkspace and EditorHost", async () => {
    const container = await renderWorkspace({
      id: "openknowledge",
      name: "fine",
      path: "/workspace/fine",
      status: "recording",
      markdownDialect: "openknowledge-mdx",
    });

    await waitFor(() => container.querySelector('[data-preview-state="ready"]') !== null);

    expect(container.querySelector(".cm-md-mdx-tabs-widget")).not.toBeNull();
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(container.querySelector(".cm-md-html-widget")).toBeNull();
  });

  it("keeps the same .md source conservative without Host dialect metadata", async () => {
    const container = await renderWorkspace({
      id: "ordinary",
      name: "ordinary",
      path: "/workspace/ordinary",
      status: "recording",
    });

    await waitFor(() => container.querySelector('[data-preview-state="ready"]') !== null);

    expect(container.querySelector(".cm-md-mdx-tabs-widget")).toBeNull();
    expect(container.querySelector(".cm-md-html-widget")).toBeNull();
    expect(container.querySelector(".cm-content")?.textContent).toContain("Tabs");
  });
});

async function renderWorkspace(workspace: Workspace): Promise<HTMLElement> {
  const node = {
    id: DOCUMENT_PATH,
    path: DOCUMENT_PATH,
    name: DOCUMENT_PATH,
    type: "markdown",
    mimeType: "text/markdown",
  } satisfies DataNode;
  const dataPort: DataPort = {
    listChildren: vi.fn<NonNullable<DataPort["listChildren"]>>(async () => [node]),
    readFile: vi.fn<NonNullable<DataPort["readFile"]>>(async () => ({
      ...node,
      content: COMPONENT_SOURCE,
      version: "v1",
    })),
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(withTestLocalization(
      <DataWorkspace
        workspace={workspace}
        dataPort={dataPort}
        defaultActivePath={DOCUMENT_PATH}
        showHeader={false}
        showPreviewHeader={false}
        enableMarkdownLinkContentIndexing={false}
      />,
    ));
  });
  return container;
}

async function waitFor(assertion: () => boolean, attempts = 800): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (assertion()) return;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 5));
    });
  }
  throw new Error("Timed out waiting for the Markdown dialect integration state.");
}
