import assert from "node:assert/strict";
import { Command } from "commander";

import { ApiError } from "../src/api.js";
import {
  buildCopyMoveIntents,
  isNoClobber,
  resolveOverwritePromptPath,
} from "../src/commands/fs/lib/operation-intent.js";
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

assert.deepEqual(buildCopyMoveIntents(["a.md", "docs/"], {}, "cp"), [
  {
    oldPath: "a.md",
    newPath: "docs",
    targetDirectory: true,
    noTargetDirectory: false,
  },
]);

assert.deepEqual(buildCopyMoveIntents(["a.md", "b.md", "docs"], {}, "cp"), [
  {
    oldPath: "a.md",
    newPath: "docs",
    targetDirectory: true,
    noTargetDirectory: false,
  },
  {
    oldPath: "b.md",
    newPath: "docs",
    targetDirectory: true,
    noTargetDirectory: false,
  },
]);

assert.deepEqual(buildCopyMoveIntents(["a.md", "docs"], { targetDirectory: false }, "mv"), [
  {
    oldPath: "a.md",
    newPath: "docs",
    targetDirectory: false,
    noTargetDirectory: true,
  },
]);

assert.throws(
  () => buildCopyMoveIntents(["a.md", "b.md", "docs"], { targetDirectory: false }, "cp"),
  ApiError,
);

assert.deepEqual(buildCopyMoveIntents(["a.md"], { targetDirectory: "docs" }, "cp"), [
  {
    oldPath: "a.md",
    newPath: "docs",
    targetDirectory: true,
    noTargetDirectory: false,
  },
]);

assert.equal(isNoClobber({ clobber: false }), true);
assert.equal(isNoClobber({ noClobber: true }), true);
assert.equal(isNoClobber({ clobber: true }), false);

assert.equal(
  await resolveOverwritePromptPath(async (path) => {
    if (path === "docs") return { exists: true, type: "folder" };
    if (path === "docs/a.md") return { exists: true, type: "markdown" };
    return { exists: false, type: "" };
  }, {
    oldPath: "a.md",
    newPath: "docs",
    targetDirectory: true,
    noTargetDirectory: false,
  }),
  "docs/a.md",
);

{
  const program = new Command();
  program.exitOverride();
  program.enablePositionalOptions();
  program.option("-p, --project <id>");

  const fs = program.command("fs");
  let parsed = null;
  fs
    .command("mkdir")
    .argument("<paths...>")
    .option("-p, --parents")
    .action((paths, opts) => {
      parsed = { paths, parents: opts.parents };
    });

  program.parse(["node", "puppyone", "fs", "mkdir", "-p", "a/b/c"]);
  assert.deepEqual(parsed, { paths: ["a/b/c"], parents: true });
}

{
  const program = new Command();
  program.exitOverride();
  program.enablePositionalOptions();

  const fs = program.command("fs");
  let parsed = null;
  fs
    .command("cp")
    .argument("<paths...>")
    .option("-T, --no-target-directory")
    .option("-t, --target-directory <dir>")
    .option("-n, --no-clobber")
    .action((paths, opts) => {
      parsed = { paths, opts };
    });

  program.parse(["node", "puppyone", "fs", "cp", "-T", "-n", "a.md", "docs"]);
  assert.deepEqual(parsed, {
    paths: ["a.md", "docs"],
    opts: { targetDirectory: false, clobber: false },
  });
}
