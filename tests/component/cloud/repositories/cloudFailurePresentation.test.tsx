/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocalFolderCloudNotice } from "../../../../src/features/cloud/project/LocalFolderCloudNotice";
import { resolveLocalFolderCloudNotice } from "../../../../src/features/cloud/project/localFolderCloudNoticeState";
import { describeCloudConnectionFailure } from "../../../../src/features/cloud/cloudOpeningFailure";
import { cloudMessage } from "../../../../src/features/cloud/cloudPresentation";
import type { ProjectCloudContext } from "../../../../src/features/cloud/project/context";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const actions = { onOpenCloudProject: vi.fn(), onSignIn: vi.fn(), onPutInCloud: vi.fn(), onRetry: vi.fn(), onDismiss: vi.fn() };
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllMocks(); });
async function render(context: ProjectCloudContext) {
  const notice = resolveLocalFolderCloudNotice(context)!;
  await act(async () => root.render(withTestLocalization(<LocalFolderCloudNotice notice={notice} {...actions} />)));
}
const buttons = () => [...host.querySelectorAll<HTMLButtonElement>("button")].map((button) => button.textContent || button.getAttribute("aria-label"));

it("states a readable server-side cause in the folder's notice, without technical detail", async () => {
  const message = describeCloudConnectionFailure({ status: 503, code: "project_authorization_unreachable" })!;
  await render({ status: "temporarily-unavailable", projectId: "p", message: { ...message, detail: "https://private-db secret" } });
  expect(host.textContent).toContain("This folder’s Cloud project can’t be reached right now. "
    + "Cloud couldn’t connect to its access-check service. Try again shortly.");
  expect(host.textContent).not.toMatch(/secret|private-db/);
  const retry = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Retry")!;
  await act(async () => retry.click());
  expect(actions.onRetry).toHaveBeenCalledOnce();
});

it.each(["wrong-account", "not-authorized"] as const)("offers an appropriate action for %s instead of a retry loop", async (status) => {
  await render({ status, projectId: "p", message: cloudMessage(status === "wrong-account" ? "remote-sign-in" : "remote-not-authorized") });
  expect(buttons()).not.toContain("Retry");
  if (status === "wrong-account") {
    const signIn = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Sign in")!;
    await act(async () => signIn.click());
    expect(actions.onSignIn).toHaveBeenCalledOnce();
  } else expect(buttons().filter((label) => label !== "Dismiss")).toHaveLength(0);
  expect(actions.onRetry).not.toHaveBeenCalled();
});
