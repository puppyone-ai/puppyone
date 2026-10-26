/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CloudWorkspaceRecovery } from "../../../../src/features/cloud/workbench/CloudWorkspaceRecovery";
import { RepositoryCloudSwitchGate } from "../../../../src/features/cloud/workbench/RepositoryCloudSwitchGate";
import { describeCloudConnectionFailure } from "../../../../src/features/cloud/cloudOpeningFailure";
import { cloudMessage } from "../../../../src/features/cloud/cloudPresentation";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("shows a readable server-side cause, with technical evidence collapsed", async () => {
  const retry = vi.fn();
  const message = describeCloudConnectionFailure({ status: 503, code: "project_authorization_unreachable" })!;
  await act(async () => root.render(withTestLocalization(<CloudWorkspaceRecovery
    message={{ ...message, detail: "https://private-db secret" }} onRetry={retry} showLocalState />)));
  expect(host.querySelector("strong")?.textContent).toBe("Can’t verify access yet");
  expect(host.querySelector("p")?.textContent).toBe("Cloud couldn’t connect to its access-check service. Try again shortly.");
  expect(host.querySelector("details")?.open).toBe(false);
  expect(host.querySelector("details")?.textContent).toContain("HTTP 503");
  expect(host.textContent).not.toMatch(/secret|private-db/);
  await act(async () => host.querySelector("button")!.click());
  expect(retry).toHaveBeenCalledOnce();
});

it.each(["wrong-account", "not-authorized"] as const)("offers an appropriate action for %s instead of a retry loop", async (status) => {
  const account = vi.fn(), retry = vi.fn();
  const apiBaseUrl = "https://cloud.example/api/v1";
  await act(async () => root.render(withTestLocalization(<RepositoryCloudSwitchGate
    apiBaseUrl={apiBaseUrl} onRetry={retry} onOpenAccount={account}
    context={{ status, projectId: "p", message: cloudMessage(status === "wrong-account" ? "remote-sign-in" : "remote-not-authorized") }}
    authState={{ status: "signed-in", apiBaseUrl, session: { user_id: "u", user_email: "a@example.com", api_base_url: apiBaseUrl,
      session_generation: "one", expires_at: 4102444800, expires_in: 3600, status: "authenticated" } }} />)));
  expect(host.textContent).not.toContain("Retry");
  if (status === "wrong-account") {
    await act(async () => host.querySelector("button")!.click());
    expect(account).toHaveBeenCalledOnce();
  } else expect(host.querySelector("button")).toBeNull();
  expect(retry).not.toHaveBeenCalled();
});
