import { describe, expect, it, vi } from "vitest";
import { appendWorkspaceContentChange, createWorkspaceContentChange } from "../../../../packages/shared-ui/src/core/workspaceContentChange";
import { DocumentDependencyIndex } from "../../../../packages/shared-ui/src/editor/resource/DocumentDependencyIndex";
import { acquireFileResource, invalidateFileResources, settleFileResourceReleases } from "../../../../packages/shared-ui/src/editor/resource/FileResourcePool";
import { getEditorStorageIdentity } from "../../../../packages/shared-ui/src/editor/resource/editorStorageIdentity";
import { acquireEditorHostLease, retireEditorHostLeases } from "../../../../packages/shared-ui/src/editor/runtime/EditorHostLeases";
import { holdEditorRuntimeAdmission } from "../../../../packages/shared-ui/src/editor/runtime/editorRuntimeAdmission";

const change = (sequence: number, paths: string[]) => createWorkspaceContentChange({ sequence, paths, rootUri: null });

describe("native editor host ownership", () => {
  it("waits for a late allocation and releases it without publishing the cancelled surface", async () => {
    let created!: (value: { value: string; release: () => Promise<void> }) => void;
    const release = vi.fn(async () => undefined);
    const lease = acquireEditorHostLease({ scope: "native-late", instance: "note.pdf", generation: 1 },
      () => new Promise<{ value: string; release: () => Promise<void> }>((resolve) => { created = resolve; }));
    const rejected = expect(lease.ready).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(created).toBeDefined());
    let closed = false;
    const retirement = retireEditorHostLeases("native-late", "note.pdf").then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
    created({ value: "surface", release });
    await retirement; await rejected;
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("retains a failed native release for retry and leaves unrelated resources alive", async () => {
    const release = vi.fn().mockRejectedValueOnce(new Error("native transport lost")).mockResolvedValue(undefined);
    const otherRelease = vi.fn(async () => undefined);
    const current = acquireEditorHostLease({ scope: "native-failure", instance: "a.pdf", generation: 1 }, async () => ({ value: "a", release }));
    const other = acquireEditorHostLease({ scope: "native-failure", instance: "b.pdf", generation: 1 }, async () => ({ value: "b", release: otherRelease }));
    await Promise.all([current.ready, other.ready]);
    await expect(retireEditorHostLeases("native-failure", "a.pdf")).rejects.toThrow(/not confirmed/);
    expect(otherRelease).not.toHaveBeenCalled();
    await retireEditorHostLeases("native-failure", "a.pdf");
    expect(release).toHaveBeenCalledTimes(2);
    await other.close();
  });
});

describe("editor resource ownership", () => {
  it("blocks late allocations during window retirement and reopens admission after cancellation", async () => {
    const port = { listChildren: async () => [], getFileUrl: vi.fn(async () => "blob:closing"), revokeFileUrl: vi.fn() };
    const release = holdEditorRuntimeAdmission();
    try { await expect(acquireFileResource(port, "image.png")).rejects.toMatchObject({ name: "AbortError" }); }
    finally { release(); }
    expect(port.getFileUrl).not.toHaveBeenCalled();
    const resource = await acquireFileResource(port, "image.png");
    resource.revoke(); await settleFileResourceReleases(getEditorStorageIdentity(port));
  });

  it("shares one acquisition and releases only after the final consumer", async () => {
    const port = { listChildren: async () => [], getFileUrl: vi.fn(async () => "blob:shared"), revokeFileUrl: vi.fn() };
    const [first, second] = await Promise.all([acquireFileResource(port, "image.png"), acquireFileResource(port, "image.png")]);
    expect(port.getFileUrl).toHaveBeenCalledTimes(1);
    first.revoke(); await Promise.resolve();
    expect(port.revokeFileUrl).not.toHaveBeenCalled();
    expect(second.url).toBe("blob:shared");
    second.revoke(); await settleFileResourceReleases(getEditorStorageIdentity(port));
    expect(port.revokeFileUrl).toHaveBeenCalledExactlyOnceWith("blob:shared");
  });

  it("publishes replacement URLs to every remaining subscriber before revoking the old URL", async () => {
    const events: string[] = [];
    const port = { listChildren: async () => [], getFileUrl: vi.fn().mockResolvedValueOnce("blob:1").mockResolvedValue("blob:2"),
      revokeFileUrl: vi.fn((url: string) => { events.push(`revoke:${url}`); }) };
    const resource = await acquireFileResource(port, "image.png");
    resource.subscribe((url) => events.push(`show:${url}`));
    invalidateFileResources(getEditorStorageIdentity(port), change(1, ["unrelated.png"]));
    expect(port.getFileUrl).toHaveBeenCalledTimes(1);
    invalidateFileResources(getEditorStorageIdentity(port), change(2, ["image.png"]));
    await vi.waitFor(() => expect(events).toEqual(["show:blob:2", "revoke:blob:1"]));
    resource.revoke(); await settleFileResourceReleases(getEditorStorageIdentity(port));
  });

  it("keeps failed capability revocation pending until a retry really succeeds", async () => {
    const revokeFileUrl = vi.fn().mockRejectedValue(new Error("bridge lost"));
    const port = { listChildren: async () => [], getFileUrl: async () => "blob:failed-release", revokeFileUrl };
    const resource = await acquireFileResource(port, "image.png");
    resource.revoke();
    await expect(settleFileResourceReleases(getEditorStorageIdentity(port))).rejects.toThrow("bridge lost");
    revokeFileUrl.mockResolvedValue(undefined);
    await settleFileResourceReleases(getEditorStorageIdentity(port));
    expect(revokeFileUrl.mock.calls.length).toBeGreaterThan(1);
  });

  it("does not let one cancelled acquisition cancel a sibling consumer", async () => {
    let ready!: (url: string) => void;
    const port = { listChildren: async () => [], getFileUrl: vi.fn(() => new Promise<string>((resolve) => { ready = resolve; })), revokeFileUrl: vi.fn() };
    const controller = new AbortController();
    const cancelled = acquireFileResource(port, "image.png", {}, controller.signal);
    const live = acquireFileResource(port, "image.png");
    const rejection = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve(); controller.abort(); ready("blob:live");
    await rejection;
    const resource = await live;
    expect(resource.url).toBe("blob:live");
    expect(port.revokeFileUrl).not.toHaveBeenCalled();
    resource.revoke(); await settleFileResourceReleases(getEditorStorageIdentity(port));
  });
});

describe("editor dependency preparation", () => {
  it("ignores matching entries already consumed from an accumulated notification", () => {
    const index = new DocumentDependencyIndex("sequence-test");
    const listener = vi.fn(); const stop = index.subscribe(listener);
    const dependencies = index.begin(); dependencies.track("directory", "docs"); dependencies.commit();
    const first = change(1, ["docs/a.md"]);
    index.invalidate(first);
    index.invalidate(appendWorkspaceContentChange(first, { paths: ["elsewhere.md"], rootUri: null }));
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it("keeps accepted dependencies while preparing and rejects a stale replacement", () => {
    const index = new DocumentDependencyIndex("project");
    const original = index.begin(); original.track("resource", "old.png"); expect(original.commit()).toBe(true);
    const listener = vi.fn(); const stop = index.subscribe(listener);
    const replacement = index.begin(); replacement.track("directory", "docs");
    index.invalidate(change(1, ["elsewhere/a.md"])); expect(listener).not.toHaveBeenCalled();
    index.invalidate(change(2, ["docs/new.md"])); expect(listener).toHaveBeenCalledTimes(1);
    expect(replacement.commit()).toBe(false);
    index.invalidate(change(3, ["old.png"])); expect(listener).toHaveBeenCalledTimes(2);
    const accepted = index.begin(); accepted.track("directory", "docs"); expect(accepted.commit()).toBe(true);
    index.invalidate(change(4, ["old.png"])); expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });
});
