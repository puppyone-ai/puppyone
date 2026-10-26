import { describe, expect, it, vi } from "vitest";
import { createCloudNativePreviewPorts, type CloudNativePreviewBridge } from "../../../../src/platform/cloudNativePreviewClient";

function fixture() {
  const bridge = {
    openCloudDatabasePreview: vi.fn(async (_request: Parameters<CloudNativePreviewBridge["openCloudDatabasePreview"]>[0]) => ({ ok: true as const, value: { engine:"sqlite" } })),
    readCloudDatabasePreviewPage: vi.fn(async () => ({ ok: true as const, value: { rows:[] } })),
    closeCloudNativePreview: vi.fn(async () => {}),
    convertCloudOfficeDocument: vi.fn(async () => ({ ok:true as const, value:{ bytes:new Uint8Array([1,2,3]), warnings:["conversion warning"] } })),
  };
  const source = vi.fn((path: string) => ({ apiBaseUrl:"https://fixture.test/api/v1", projectId:"project", path:`scope/${path}`,
    expectedSession:{ userId:"owner", generation:"generation" } }));
  const current = vi.fn();
  const ports = createCloudNativePreviewPorts(bridge as unknown as CloudNativePreviewBridge, source, current);
  return {bridge, source, current, ports};
}
describe("Cloud native preview port lifecycle", () => {
  it("binds the remote scope and session without exposing a native root", async () => {
    const f=fixture(), signal=new AbortController().signal;
    const lease=await f.ports.database.open("data.sqlite",signal); await lease.ready;
    expect(f.bridge.openCloudDatabasePreview.mock.calls[0]).toEqual([expect.objectContaining({ path:"scope/data.sqlite", projectId:"project",
      expectedSession:{userId:"owner", generation:"generation"}, id:expect.any(String) })]);
    expect(f.bridge.openCloudDatabasePreview.mock.calls[0][0]).not.toHaveProperty("rootPath");
    await lease.readPage({objectId:"items"},signal); await lease.close(); await lease.close();
    expect(f.bridge.closeCloudNativePreview).toHaveBeenCalledTimes(1);
  });
  it("closes failed startup and preserves the public native error", async () => {
    const f=fixture();
    f.bridge.openCloudDatabasePreview.mockResolvedValue({ok:false,error:{code:"recovery-required"}} as never);
    const lease=await f.ports.database.open("data.sqlite",new AbortController().signal);
    await expect(lease.ready).rejects.toMatchObject({code:"recovery-required"});
    expect(f.bridge.closeCloudNativePreview).toHaveBeenCalledTimes(1);
  });
  it("exposes cancellation before a delayed decoder startup acknowledges ready", async () => {
    const f=fixture(), abort=new AbortController();
    let release!: (value: unknown) => void;
    f.bridge.openCloudDatabasePreview.mockImplementation(() => new Promise(resolve=>{ release=resolve; }) as never);
    const lease=await f.ports.database.open("data.sqlite",abort.signal); abort.abort();
    await vi.waitFor(()=>expect(f.bridge.closeCloudNativePreview).toHaveBeenCalledTimes(1));
    release({ok:true,value:{engine:"sqlite"}});
    await expect(lease.ready).rejects.toThrow();
  });
  it("converts IPC bytes to the shared Office input and retains native warnings", async () => {
    const f=fixture(), result=await f.ports.convertOfficeDocumentToDocx("report.rtf");
    expect(new Uint8Array(result.arrayBuffer)).toEqual(new Uint8Array([1,2,3]));
    expect(result.warnings).toEqual(["conversion warning"]);
    expect(f.bridge.closeCloudNativePreview).toHaveBeenCalledTimes(1);
  });
});
