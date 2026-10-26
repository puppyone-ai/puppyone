import { describe, expect, it, vi } from "vitest";
import { getDocumentInputRuntime, retireDocumentInputs } from "../../../../packages/shared-ui/src/editor/resource/DocumentInputRuntime";
import { getEditorStorageIdentity } from "../../../../packages/shared-ui/src/editor/resource/editorStorageIdentity";
import { acquireFileResource, settleFileResourceReleases } from "../../../../packages/shared-ui/src/editor/resource/FileResourcePool";
import type { DataPort, DataFileUrlOptions, DocumentDataNode } from "@puppyone/shared-ui";

describe("document resource Retry", () => {
  it("does not reuse a retired runtime's capability still retained by another consumer", async () => {
    const getFileUrl=vi.fn(async (_path: string, _options?: DataFileUrlOptions) => `https://fixture.test/video?token=${crypto.randomUUID()}`);
    const port: DataPort={listChildren:async()=>[],getFileUrl};
    const node: DocumentDataNode={id:'retained-media',name:'movie.mp4',path:'movie.mp4',type:'video',source:'cloud'};
    const identity=getEditorStorageIdentity(port),first=getDocumentInputRuntime(port,node);
    const unsubscribeFirst=first.subscribe(()=>{});
    await vi.waitFor(()=>expect(first.getSnapshot().fileUrl).toBeTruthy());
    const retained=await acquireFileResource(port,node.path,getFileUrl.mock.calls[0][1],new AbortController().signal);
    unsubscribeFirst();retireDocumentInputs(identity);
    const reopened=getDocumentInputRuntime(port,node),unsubscribe=reopened.subscribe(()=>{});
    try {
      await vi.waitFor(()=>expect(getFileUrl).toHaveBeenCalledTimes(2));
      await vi.waitFor(()=>expect(reopened.getSnapshot().fileUrl).toBeTruthy());
      expect(reopened.getSnapshot().fileUrl).not.toBe(retained.url);
    } finally {unsubscribe();retained.revoke();retireDocumentInputs(identity);await settleFileResourceReleases(identity);}
  });
  it("re-signs a retained binary resource and revokes the old capability only after replacement", async () => {
    const events: string[]=[];
    const port: DataPort={listChildren:async()=>[],getFileUrl:vi.fn(async()=>`https://fixture.test/video?token=${events.push('sign')}`),
      revokeFileUrl:vi.fn((url)=>{events.push(`revoke:${url}`);})};
    const node: DocumentDataNode={id:'retry-media',name:'movie.mp4',path:'movie.mp4',type:'video',source:'cloud'};
    const identity=getEditorStorageIdentity(port), runtime=getDocumentInputRuntime(port,node);
    const unsubscribe=runtime.subscribe(()=>{});
    try {
      await vi.waitFor(()=>expect(runtime.getSnapshot().fileUrl).toContain('token=1'));
      runtime.refresh();
      await vi.waitFor(()=>expect(port.getFileUrl).toHaveBeenCalledTimes(2));
      await vi.waitFor(()=>expect(runtime.getSnapshot().fileUrl).toContain('token=2'));
      expect(events[0]).toBe('sign');expect(events[1]).toBe('sign');
      expect(events[2]).toBe('revoke:https://fixture.test/video?token=1');
    } finally {unsubscribe();retireDocumentInputs(identity);await settleFileResourceReleases(identity);}
  });
});
