import { describe, expect, it } from "vitest";
import { recoverImmutableUploads } from "../../../../scripts/release-support/immutable-upload-recovery.mjs";

function fixture(existing = new Map()) {
  const files = ["release.json", "app.zip", "SHA256SUMS"].map(name => ({ name, bytes: 10, sha256: name, path: name }));
  const calls = [];
  const store = {
    list: async prefix => [...existing.keys()].filter(key => key.startsWith(prefix)),
    digest: async key => existing.get(key),
    putMissing: async (key, file) => {
      if (existing.has(key)) throw new Error("Overwrite attempted");
      calls.push(key);
      existing.set(key, { bytes: 10, sha256: file });
    },
  };
  return { bundles: [{ prefix: "mac", files }], store, calls, files, existing };
}

describe("immutable upload incident recovery", () => {
  it("retains matching bytes and commits the marker last", async () => {
    const f = fixture(new Map([["mac/app.zip", { bytes: 10, sha256: "app.zip" }]]));
    await recoverImmutableUploads(f);
    expect(f.calls).toEqual(["mac/SHA256SUMS", "mac/release.json"]);
  });
  it("checks all targets before writing anything when an existing digest differs", async () => {
    const f = fixture(new Map([["win/app.zip", { bytes: 10, sha256: "wrong" }]]));
    f.bundles.push({ prefix: "win", files: f.files });
    await expect(recoverImmutableUploads(f)).rejects.toThrow("differs");
    expect(f.calls).toEqual([]);
  });
  it("refuses extra objects rather than deleting them", async () => {
    const f = fixture(new Map([["mac/unknown", { bytes: 10, sha256: "unknown" }]]));
    await expect(recoverImmutableUploads(f)).rejects.toThrow("Unexpected");
    expect(f.calls).toEqual([]);
  });
  it("refuses to alter a committed bundle with missing payloads", async () => {
    const f = fixture(new Map([["mac/release.json", { bytes: 10, sha256: "release.json" }]]));
    await expect(recoverImmutableUploads(f)).rejects.toThrow("Committed");
    expect(f.calls).toEqual([]);
  });
  it("keeps the marker absent when a new payload fails verification", async () => {
    const f = fixture();
    f.store.digest = async () => ({ bytes: 0, sha256: "bad" });
    await expect(recoverImmutableUploads(f)).rejects.toThrow("integrity");
    expect(f.calls).toEqual(["mac/app.zip"]);
  });
  it("does not rewrite any part of an already complete bundle", async () => {
    const f = fixture();
    for (const file of f.files) f.existing.set(`mac/${file.name}`, file);
    await recoverImmutableUploads(f);
    expect(f.calls).toEqual([]);
  });
});
