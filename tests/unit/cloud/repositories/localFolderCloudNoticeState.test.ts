import { describe, expect, it } from "vitest";
import { cloudMessage } from "../../../../src/features/cloud/cloudPresentation";
import type { ProjectCloudContext } from "../../../../src/features/cloud/project/context";
import {
  localFolderCloudNoticeKey,
  resolveLocalFolderCloudEntry,
  resolveLocalFolderCloudNotice,
} from "../../../../src/features/cloud/project/localFolderCloudNoticeState";

const target = { kind: "project_root", project_id: "p1" } as const;
const contexts: Record<ProjectCloudContext["status"], ProjectCloudContext> = {
  "local-only": { status: "local-only", projectId: null },
  resolving: { status: "resolving", projectId: null },
  resolved: { status: "resolved", projectId: "p1", projectName: " Vault ", target },
  "wrong-account": { status: "wrong-account", projectId: "p1", message: cloudMessage("remote-sign-in") },
  "wrong-host": { status: "wrong-host", projectId: "p1", message: cloudMessage("remote-wrong-host", { origin: "http://api.puppyone.ai" }) },
  "not-found": { status: "not-found", projectId: "p1", message: cloudMessage("remote-not-found") },
  "not-authorized": { status: "not-authorized", projectId: "p1", message: cloudMessage("remote-not-authorized") },
  "locator-conflict": { status: "locator-conflict", projectId: null, message: cloudMessage("remote-locator-conflict") },
  "temporarily-unavailable": { status: "temporarily-unavailable", projectId: "p1", message: cloudMessage("remote-network-failed") },
  unresolvable: { status: "unresolvable", projectId: null, message: cloudMessage("remote-unresolvable") },
  error: { status: "error", projectId: null, message: cloudMessage("remote-unresolvable") },
};

describe("local folder Cloud notice", () => {
  it("describes every association state and never treats it as a gate", () => {
    expect(Object.fromEntries(Object.entries(contexts).map(([status, context]) => [status, resolveLocalFolderCloudNotice(context)]))).toEqual({
      "local-only": null,
      resolving: null,
      resolved: { kind: "linked", projectId: "p1", projectName: "Vault", openable: true },
      "wrong-account": { kind: "sign-in" },
      "wrong-host": { kind: "other-environment", origin: "http://api.puppyone.ai" },
      "not-found": { kind: "missing" },
      "not-authorized": { kind: "no-access" },
      "locator-conflict": { kind: "ambiguous" },
      "temporarily-unavailable": { kind: "unreachable", cause: cloudMessage("remote-network-failed") },
      unresolvable: { kind: "unreachable", cause: cloudMessage("remote-unresolvable") },
      error: { kind: "unreachable", cause: cloudMessage("remote-unresolvable") },
    });
  });

  it("opens a linked folder's Cloud project as another project and never switches the folder", () => {
    const entries = (signedIn: boolean) => Object.fromEntries(Object.entries(contexts).map(([status, context]) =>
      [status, resolveLocalFolderCloudEntry(context, { signedIn, publishPending: false }).kind]));
    expect(entries(true)).toEqual({
      "local-only": "publish",
      resolving: "cloud-dialog",
      resolved: "open",
      "wrong-account": "explain",
      "wrong-host": "explain",
      "not-found": "explain",
      "not-authorized": "explain",
      "locator-conflict": "explain",
      "temporarily-unavailable": "explain",
      unresolvable: "explain",
      error: "explain",
    });
    expect(entries(false)["wrong-account"]).toBe("cloud-dialog");
    expect(resolveLocalFolderCloudEntry(contexts.resolved, { signedIn: true, publishPending: false }))
      .toEqual({ kind: "open", projectId: "p1" });
  });

  it("never broadens a scoped checkout into its whole Cloud project", () => {
    const scoped: ProjectCloudContext = { status: "resolved", projectId: "p1", projectName: "Vault",
      target: { kind: "scope", project_id: "p1", scope_id: "s1" }, scopePath: "docs" };
    expect(resolveLocalFolderCloudNotice(scoped)).toEqual({ kind: "linked", projectId: "p1", projectName: "Vault", openable: false });
    expect(resolveLocalFolderCloudEntry(scoped, { signedIn: true, publishPending: false })).toEqual({ kind: "explain" });
  });

  it("continues a running or saved first publish instead of opening its new Cloud project", () => {
    expect(resolveLocalFolderCloudEntry(contexts.resolved, { signedIn: true, publishPending: true })).toEqual({ kind: "publish" });
  });

  it("keeps an unnamed project and an origin-less environment presentable", () => {
    expect(resolveLocalFolderCloudNotice({ status: "resolved", projectId: "p1", projectName: "  ", target }))
      .toEqual({ kind: "linked", projectId: "p1", projectName: null, openable: true });
    expect(resolveLocalFolderCloudNotice({ status: "wrong-host", projectId: null, message: cloudMessage("remote-wrong-host") }))
      .toEqual({ kind: "other-environment", origin: null });
  });

  it("changes its dismissal key when the folder or what the association means changes", () => {
    const linked = resolveLocalFolderCloudNotice(contexts.resolved);
    const other = resolveLocalFolderCloudNotice(contexts["wrong-host"]);
    expect(localFolderCloudNoticeKey("/a", linked)).not.toBe(localFolderCloudNoticeKey("/b", linked));
    expect(localFolderCloudNoticeKey("/a", linked)).not.toBe(localFolderCloudNoticeKey("/a", other));
    expect(localFolderCloudNoticeKey("/a", null)).toBeNull();
    expect(localFolderCloudNoticeKey(null, linked)).toBeNull();
  });
});
