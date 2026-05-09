import assert from "node:assert/strict";

import { pathError } from "../src/commands/fs/lib/errors.js";
import {
  renderFlatLs,
  renderRecursiveLs,
  renderTree,
  sortEntries,
} from "../src/commands/fs/lib/render.js";

function captureRaw(render) {
  const chunks = [];
  render({ raw: (text) => chunks.push(text) });
  return chunks.join("\n");
}

const entries = [
  {
    name: "docs",
    path: "docs",
    type: "folder",
    size_bytes: 0,
    modified_at: "2026-01-02T00:00:00.000Z",
  },
  {
    name: "readme.md",
    path: "readme.md",
    type: "markdown",
    size_bytes: 42,
    modified_at: "2026-01-03T00:00:00.000Z",
  },
];

assert.equal(
  captureRaw((out) => renderFlatLs(out, entries, {})),
  "docs\nreadme.md",
);

assert.equal(
  captureRaw((out) => renderFlatLs(out, entries, { classify: true })),
  "docs/\nreadme.md",
);

assert.equal(
  captureRaw((out) => renderTree(out, [
    { name: "docs", path: "docs", type: "folder" },
    { name: "guide.md", path: "docs/guide.md", type: "markdown" },
    { name: "readme.md", path: "readme.md", type: "markdown" },
  ], ".")),
  [
    ".",
    "|-- docs",
    "|   `-- guide.md",
    "`-- readme.md",
    "",
    "1 directory, 2 files",
  ].join("\n"),
);

assert.equal(
  captureRaw((out) => renderRecursiveLs(out, [
    { name: "docs", path: "docs", type: "folder" },
    { name: "guide.md", path: "docs/guide.md", type: "markdown" },
    { name: "readme.md", path: "readme.md", type: "markdown" },
  ], {})),
  [
    ".:",
    "docs",
    "readme.md",
    "",
    "docs:",
    "guide.md",
  ].join("\n"),
);

assert.deepEqual(
  sortEntries([
    { name: "b.txt", size_bytes: 2 },
    { name: "a.txt", size_bytes: 1 },
  ], { sort: "name" }).map((entry) => entry.name),
  ["a.txt", "b.txt"],
);

assert.equal(
  pathError("cat", "missing.txt", new Error("File not found: missing.txt")),
  "cat: missing.txt: File not found: missing.txt",
);

const recursiveJsonShape = {
  success: true,
  complete: false,
  truncated: true,
  limit: 2,
  returned_count: 2,
  truncation_reason: "entry_limit_exceeded",
};

assert.deepEqual(Object.keys(recursiveJsonShape), [
  "success",
  "complete",
  "truncated",
  "limit",
  "returned_count",
  "truncation_reason",
]);
