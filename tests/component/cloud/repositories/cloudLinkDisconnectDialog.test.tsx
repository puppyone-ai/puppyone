/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canDisconnectCloudLink,
  CloudLinkDisconnectDialog,
  unsentCloudCommits,
  type CloudLinkStatus,
} from "../../../../src/features/cloud/project/CloudLinkDisconnectDialog";
import { gitStatus } from "../../../support/source-control/gitFixtures";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// A link to another environment is ended exactly like one on this app's Cloud.
const otherEnvironment = "http://localhost:9090/git/01a0e7da-6575-7771-af76-48b47dde4ba6.git";
const github = "https://github.com/fixture/project.git";
const remotes = [
  { name: "puppyone", fetchUrl: otherEnvironment, pushUrl: otherEnvironment, branches: [] },
  { name: "origin", fetchUrl: github, pushUrl: github, branches: [] },
];
const unsent = (ahead: number, remote = "puppyone"): CloudLinkStatus => ({
  remotes, sourceControl: { remote: { target: { remote, exists: true, ahead } } },
});
const disconnect = vi.fn();
const cancel = vi.fn();
const done = vi.fn();
let root: Root;
let host: HTMLDivElement;
async function render(status: CloudLinkStatus | null, projectName: string | null = null) {
  await act(async () => root.render(withTestLocalization(<CloudLinkDisconnectDialog projectName={projectName}
    status={status} onDisconnect={disconnect} onCancel={cancel} onDone={done} />)));
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
async function press(label: string) {
  const button = [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label)!;
  await act(async () => button.click());
}
beforeEach(() => {
  disconnect.mockReset(); cancel.mockReset(); done.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

describe("ending a folder's Cloud link", () => {
  it("is offered for exactly one Cloud connection named puppyone, on any environment", () => {
    expect(canDisconnectCloudLink(gitStatus({ remotes }))).toBe(true);
    expect(canDisconnectCloudLink(gitStatus({ remotes: [...remotes, { ...remotes[0]!, name: "cloud-copy" }] }))).toBe(false);
    expect(canDisconnectCloudLink(gitStatus({ remotes: [{ ...remotes[0]!, name: "cloud-copy" }] }))).toBe(false);
    expect(canDisconnectCloudLink(gitStatus({ remotes: [remotes[1]!] }))).toBe(false);
    expect(canDisconnectCloudLink(null)).toBe(false);
  });

  it("counts only commits the linked Cloud project has not received", () => {
    expect(unsentCloudCommits(unsent(3))).toBe(3);
    expect(unsentCloudCommits(unsent(3, "origin"))).toBe(0);
    expect(unsentCloudCommits({ remotes, sourceControl: { remote: { target: { remote: "puppyone", exists: false, ahead: 4 } } } }))
      .toBe(0);
    expect(unsentCloudCommits({ remotes })).toBe(0);
  });

  it("says the Cloud project and the files stay, and keeps the focus on Cancel", async () => {
    await render({ remotes }, "To-Do-List");
    expect(dialog()?.textContent).toContain("Disconnect from Cloud?");
    expect(dialog()?.textContent).toContain(
      "This folder will no longer be linked to ⁨To-Do-List⁩. The Cloud project isn’t deleted, and your files here stay as they are.");
    expect(dialog()?.textContent).not.toContain("commit");
    expect(dialog()?.querySelector("[data-desktop-dialog-initial-focus]")?.textContent).toBe("Cancel");
    await press("Cancel");
    expect(cancel).toHaveBeenCalledOnce();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("warns about commits that will not be sent", async () => {
    await render(unsent(5));
    expect(dialog()?.textContent).toContain("This folder will no longer be linked to its Cloud project.");
    expect(dialog()?.textContent).toContain("5 commits haven’t been sent to the Cloud yet.");
  });

  it("removes exactly the reviewed connection, then finishes", async () => {
    let finish!: () => void;
    disconnect.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    await render({ remotes: remotes.map((remote) => ({ ...remote })) });
    await press("Disconnect");
    expect(disconnect).toHaveBeenCalledWith(remotes);
    expect(dialog()?.textContent).toContain("Disconnecting…");
    expect([...dialog()!.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
    await act(async () => finish());
    expect(done).toHaveBeenCalledOnce();
  });

  it("keeps the link and says so when ending it fails", async () => {
    disconnect.mockRejectedValue(new Error("Git remotes changed after the Cloud connection was reviewed."));
    await render({ remotes });
    await press("Disconnect");
    expect(done).not.toHaveBeenCalled();
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe("Couldn’t disconnect. Refresh and try again.");
    expect(dialog()?.querySelector<HTMLButtonElement>(".desktop-dialog-button.destructive")?.disabled).toBe(false);
  });
});
