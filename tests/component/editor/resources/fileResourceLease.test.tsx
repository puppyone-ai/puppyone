/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceContentChange,
  PRESET_VIEWERS,
  resolveEditorViewer,
  useFileResourceLease,
  type DataPort,
  type WorkspaceContentChange,
} from "@puppyone/shared-ui";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type ResourceCase = Readonly<{
  viewerId: string;
  path: string;
  type: string;
  mimeType: string;
}>;

const RESOURCE_CASES: readonly ResourceCase[] = [
  { viewerId: "html-artifact", path: "page.html", type: "html", mimeType: "text/html" },
  { viewerId: "image-preview", path: "photo.png", type: "image", mimeType: "image/png" },
  { viewerId: "pdf-preview", path: "report.pdf", type: "pdf", mimeType: "application/pdf" },
  {
    viewerId: "office-preview",
    path: "report.docx",
    type: "file",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  { viewerId: "audio-preview", path: "recording.mp3", type: "audio", mimeType: "audio/mpeg" },
  { viewerId: "video-preview", path: "clip.mp4", type: "video", mimeType: "video/mp4" },
];

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("file resource lease", () => {
  it("requires every built-in resource Viewer family to have an invalidation fixture", () => {
    const expected = PRESET_VIEWERS
      .filter(({ source }) => source === "resource" || source === "content-and-resource")
      .map(({ id }) => id)
      .sort();
    expect(RESOURCE_CASES.map(({ viewerId }) => viewerId).sort()).toEqual(expected);
  });

  it.each(RESOURCE_CASES)(
    "$viewerId reacquires only for its own external change and retires the previous lease",
    async (formatCase) => {
      const getFileUrl = vi.fn(async (path: string) => `blob:${path}:${getFileUrl.mock.calls.length}`);
      const revokeFileUrl = vi.fn(async () => undefined);
      const dataPort: DataPort = {
        listChildren: vi.fn(async () => []),
        getFileUrl,
        revokeFileUrl,
      };
      expect(resolveEditorViewer({
        path: formatCase.path,
        name: formatCase.path,
        type: formatCase.type,
        mimeType: formatCase.mimeType,
      }).viewer.id).toBe(formatCase.viewerId);

      const container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      const render = async (refresh: WorkspaceContentChange) => {
        await act(async () => {
          root?.render(
            <ResourceLeaseProbe
              dataPort={dataPort}
              path={formatCase.path}
              refresh={refresh}
            />,
          );
          await Promise.resolve();
        });
      };

      await render(change(0, []));
      await waitFor(() => getFileUrl.mock.calls.length === 1);
      const firstUrl = container.dataset.url;
      expect(firstUrl).toBe(`blob:${formatCase.path}:1`);

      await render(change(1, ["unrelated.txt"]));
      expect(getFileUrl).toHaveBeenCalledTimes(1);
      expect(container.dataset.url).toBe(firstUrl);

      await render(change(2, [formatCase.path]));
      await waitFor(() => getFileUrl.mock.calls.length === 2 && container.dataset.url !== firstUrl);
      expect(container.dataset.url).toBe(`blob:${formatCase.path}:2`);
      expect(revokeFileUrl).toHaveBeenCalledWith(firstUrl);
    },
  );

  it("treats a null path list as a real bulk resource invalidation", async () => {
    const getFileUrl = vi.fn(async () => `blob:photo:${getFileUrl.mock.calls.length}`);
    const dataPort: DataPort = {
      listChildren: vi.fn(async () => []),
      getFileUrl,
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ResourceLeaseProbe dataPort={dataPort} path="photo.png" refresh={change(0, [])} />);
      await Promise.resolve();
    });
    await waitFor(() => getFileUrl.mock.calls.length === 1);
    await act(async () => {
      root?.render(<ResourceLeaseProbe dataPort={dataPort} path="photo.png" refresh={change(1, null)} />);
      await Promise.resolve();
    });
    await waitFor(() => getFileUrl.mock.calls.length === 2);
  });
});

function ResourceLeaseProbe({
  dataPort,
  path,
  refresh,
}: {
  dataPort: DataPort;
  path: string;
  refresh: WorkspaceContentChange;
}) {
  const state = useFileResourceLease({ dataPort, enabled: true, path, refresh });
  return (
    <div
      ref={(element) => {
        if (!element) return;
        element.parentElement!.dataset.url = state.fileUrl ?? "";
        element.parentElement!.dataset.loading = String(state.fileUrlLoading);
      }}
    />
  );
}

function change(sequence: number, paths: readonly string[] | null): WorkspaceContentChange {
  return createWorkspaceContentChange({ sequence, rootUri: null, paths });
}

async function waitFor(assertion: () => boolean, attempts = 100): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (assertion()) return;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 2));
    });
  }
  throw new Error("Timed out waiting for resource lease state.");
}
