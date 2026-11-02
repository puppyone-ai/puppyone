/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalFolderCloudNotice } from "../../../../src/features/cloud/project/LocalFolderCloudNotice";
import type { LocalFolderCloudNotice as Notice } from "../../../../src/features/cloud/project/localFolderCloudNoticeState";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const actions = { onOpenCloudProject: vi.fn(), onSignIn: vi.fn(), onPutInCloud: vi.fn(), onRetry: vi.fn(), onDismiss: vi.fn() };

async function render(notice: Notice) {
  await act(async () => root.render(withTestLocalization(<LocalFolderCloudNotice notice={notice} {...actions} />)));
}
function buttons() {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].map((button) => button.textContent || button.getAttribute("aria-label"));
}
async function click(label: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === label)!;
  await act(async () => button.click());
}
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.clearAllMocks(); });

describe("LocalFolderCloudNotice", () => {
  it("says a linked folder and its Cloud project are two projects and opens the Cloud one separately", async () => {
    await render({ kind: "linked", projectId: "p1", projectName: "Vault", openable: true });
    expect(host.textContent).toContain(
      "This folder has a Cloud project, Vault. People and agents work there in real time; changes here reach it only when you send them.",
    );
    await click("Open Cloud project");
    expect(actions.onOpenCloudProject).toHaveBeenCalledWith("p1");
    expect(actions.onPutInCloud).not.toHaveBeenCalled();
  });

  it("does not offer to open the whole Cloud project from a scoped checkout", async () => {
    await render({ kind: "linked", projectId: "p1", projectName: "Vault", openable: false });
    expect(host.textContent).toContain("This folder has a Cloud project, Vault.");
    expect(buttons()).not.toContain("Open Cloud project");
  });

  it("explains another environment without offering an action that cannot succeed", async () => {
    await render({ kind: "other-environment", origin: "http://api.puppyone.ai" });
    expect(host.textContent).toContain("This folder’s Cloud project is in another Puppyone environment (http://api.puppyone.ai).");
    expect(buttons()).not.toContain("Open Cloud project");
    expect(host.textContent).not.toContain("Reconnect");
  });

  it.each([
    [{ kind: "sign-in" } as Notice, "Sign in", "onSignIn"],
    [{ kind: "missing" } as Notice, "Put in the Cloud again", "onPutInCloud"],
    [{ kind: "unreachable", cause: null } as Notice, "Retry", "onRetry"],
  ] as const)("offers the one action that helps for %o", async (notice, label, handler) => {
    await render(notice);
    await click(label);
    expect(actions[handler]).toHaveBeenCalledOnce();
  });

  it("only explains a missing Cloud project whose old link this app cannot retire", async () => {
    await act(async () => root.render(withTestLocalization(<LocalFolderCloudNotice notice={{ kind: "missing" }}
      {...actions} onPutInCloud={undefined} />)));
    expect(host.textContent).toContain("This folder’s Cloud project is no longer available.");
    expect(host.textContent).not.toContain("put the folder in the Cloud again");
    expect(buttons().filter((label) => label !== "Dismiss")).toHaveLength(0);
  });

  it.each([{ kind: "no-access" }, { kind: "ambiguous" }] as Notice[])("only explains %o", async (notice) => {
    await render(notice);
    expect(buttons().filter((label) => label !== "Dismiss")).toHaveLength(0);
  });

  it("can be dismissed", async () => {
    await render({ kind: "linked", projectId: "p1", projectName: null, openable: true });
    expect(host.textContent).toContain("This folder has a Cloud project. People and agents work there in real time");
    const dismiss = host.querySelector<HTMLButtonElement>(".desktop-local-folder-cloud-notice .po-floating-notice__dismiss")!;
    await act(async () => dismiss.click());
    expect(actions.onDismiss).toHaveBeenCalledOnce();
  });
});
