import { describe, expect, it } from "vitest";
import type { FileContent } from "../../../../packages/shared-ui/src/core/types";
import {
  FILE_CONTENT_CACHE_MAX_CHARACTERS,
  FILE_CONTENT_CACHE_MAX_ENTRIES,
  putBoundedFileContent,
} from "../../../../packages/shared-ui/src/data/file-open/fileContentCache";

describe("bounded file content cache", () => {
  it("retains only the most recently used entry count", () => {
    let cache: Record<string, FileContent> = {};
    for (let index = 0; index < FILE_CONTENT_CACHE_MAX_ENTRIES + 3; index += 1) {
      cache = putBoundedFileContent(cache, makeContent(`note-${index}.md`, "content"));
    }

    expect(Object.keys(cache)).toHaveLength(FILE_CONTENT_CACHE_MAX_ENTRIES);
    expect(cache["note-0.md"]).toBeUndefined();
    expect(cache[`note-${FILE_CONTENT_CACHE_MAX_ENTRIES + 2}.md`]).toBeDefined();
  });

  it("refreshes an existing path to MRU and respects the total source budget", () => {
    const halfBudget = Math.floor(FILE_CONTENT_CACHE_MAX_CHARACTERS / 2);
    let cache = putBoundedFileContent({}, makeContent("a.md", "a".repeat(halfBudget)));
    cache = putBoundedFileContent(cache, makeContent("b.md", "b".repeat(halfBudget)));
    cache = putBoundedFileContent(cache, makeContent("a.md", "updated"));
    cache = putBoundedFileContent(cache, makeContent("c.md", "c".repeat(halfBudget + 1)));

    expect(Object.keys(cache)).toEqual(["a.md", "c.md"]);
  });

  it("does not retain a single over-budget payload", () => {
    const cache = putBoundedFileContent(
      {},
      makeContent("oversized.md", "x".repeat(FILE_CONTENT_CACHE_MAX_CHARACTERS + 1)),
    );

    expect(cache).toEqual({});
  });
});

function makeContent(path: string, content: string): FileContent {
  return { path, name: path, type: "markdown", content };
}
