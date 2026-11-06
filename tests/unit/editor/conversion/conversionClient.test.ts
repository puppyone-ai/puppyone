import { describe, expect, it, vi } from "vitest";
import { fetchOfficeArrayBuffer } from "../../../../src/shared-ui/editor/viewers/office/officeResourceLoader";
import { fingerprintConversionSource } from "../../../../src/shared-ui/editor/conversion/conversionClient";
vi.mock("../../../../src/shared-ui/editor/viewers/office/officeResourceLoader", () => ({ fetchOfficeArrayBuffer: vi.fn() }));
describe("conversion source fingerprint", () => {
  it("freezes the bounded resizable fetch buffer before Web Crypto and Worker handoff", async () => {
    const Constructor = ArrayBuffer as typeof ArrayBuffer & { new(size: number, options: { maxByteLength: number }): ArrayBuffer };
    const bytes = new Constructor(3, { maxByteLength: 100 }); new Uint8Array(bytes).set([97,98,99]);
    vi.mocked(fetchOfficeArrayBuffer).mockResolvedValue(bytes);
    const result = await fingerprintConversionSource("blob:source");
    expect((result.bytes as ArrayBuffer & { resizable: boolean }).resizable).toBe(false);
    expect(result.fingerprint).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
