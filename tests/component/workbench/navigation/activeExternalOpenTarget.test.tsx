/**
 * @vitest-environment happy-dom
 */
import type { Workspace } from "@puppyone/shared-ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useExternalFileOpen } from "../../../../src/features/external-apps/useExternalFileOpen";
import { openWorkspaceEntryExternal } from "../../../../src/lib/localFiles";

vi.mock("../../../../src/lib/localFiles", () => ({
  openWorkspaceEntryExternal: vi.fn(),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const workspace: Workspace = {
  id: "workspace-1",
  name: "Workspace",
  path: "/workspace",
  status: "recording",
};

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("pane-scoped external file opening", () => {
  it("opens the exact pane resource with the system default app", async () => {
    const controller = await renderHarness();
    await act(async () => controller.open("second-pane/notes.md"));
    expect(openWorkspaceEntryExternal).toHaveBeenCalledWith({
      rootPath: "/workspace",
      path: "second-pane/notes.md",
    });
  });
});

async function renderHarness() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const controller: { current: ReturnType<typeof useExternalFileOpen> | null } = { current: null };

  function Harness() {
    controller.current = useExternalFileOpen({
      onError: vi.fn(),
      workspace,
    });
    return null;
  }

  await act(async () => root?.render(<Harness />));
  if (!controller.current) throw new Error("External file controller did not initialize.");
  return controller.current;
}
