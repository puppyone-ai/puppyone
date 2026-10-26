/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useRepositoryCloudWorkspaceSwitch } from "../../../../src/features/cloud/workbench/useRepositoryCloudWorkspaceSwitch";
import { cloudMessage } from "../../../../src/features/cloud/cloudPresentation";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("opening a repository after a dependency outage", () => {
  it.each(["temporarily-unavailable", "not-authorized"] as const)("revalidates a stale transient error only: %s", async (status) => {
    const revalidate = vi.fn();
    const onPrepared = vi.fn();
    let controller!: ReturnType<typeof useRepositoryCloudWorkspaceSwitch>;
    function Harness() {
      controller = useRepositoryCloudWorkspaceSwitch({ enabled: true, scope: "local-repository",
        context: { status, projectId: "p", message: cloudMessage("remote-network-failed") },
        session: null, apiBaseUrl: "https://api.example/api/v1", onPrepared, onRevalidate: revalidate });
      return null;
    }
    const node = document.createElement("div");
    const root = createRoot(node);
    try {
      await act(async () => root.render(<Harness />));
      await act(async () => controller.request());
      expect(revalidate).toHaveBeenCalledTimes(status === "temporarily-unavailable" ? 1 : 0);
      expect(onPrepared).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); }
  });
});
