import { describe, expect, it } from "vitest";
import { mergeMetadataInvalidationReason } from "../../../../electron/main/git-metadata-watch-service.mjs";

describe("mergeMetadataInvalidationReason", () => {
  it("keeps a stronger ref reason when a later index event arrives", () => {
    expect(mergeMetadataInvalidationReason("ref", "index")).toBe("ref");
    expect(mergeMetadataInvalidationReason("index", "ref")).toBe("ref");
  });

  it("promotes to repository-level reasons over refs", () => {
    expect(mergeMetadataInvalidationReason("ref", "git-metadata")).toBe("git-metadata");
    expect(mergeMetadataInvalidationReason("index", "repository-initialized")).toBe("repository-initialized");
  });

  it("keeps fetch/merge/config above index", () => {
    expect(mergeMetadataInvalidationReason("fetch", "index")).toBe("fetch");
    expect(mergeMetadataInvalidationReason("merge", "index")).toBe("merge");
    expect(mergeMetadataInvalidationReason("config", "index")).toBe("config");
  });
});
