// @vitest-environment node
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  baselinePath,
  buildVocabularyPattern,
  compareVocabularyBaseline,
  deriveVocabularyRules,
  documentPath,
  findVocabularyViolations,
  repositoryRoot,
  rulesPath,
} from "../../../../scripts/check-user-vocabulary.mjs";

const table = [
  "## Vocabulary",
  "",
  "| 概念 | 内部用词 | 面向用户 | 禁止 |",
  "| --- | --- | --- | --- |",
  "| 云上那份 | 汇合点 / rendezvous | 对外那一面 / Cloud | 备份 Backup，云盘 |",
  "| 可编辑副本 | 工作副本 working copy | （不出现，隐含） | Clone，Checkout |",
  "| 取到本机 | materialize | Get a copy | Download，Clone，Pull |",
  "| 别处的改动 | incoming | *X* made 3 changes | Merge，Diverged |",
  "",
  "## Prohibited patterns",
  "",
].join("\n");

function rulesFor(markdown = table) {
  return deriveVocabularyRules(markdown, "abc1234");
}

function terms(markdown = table) {
  return rulesFor(markdown).rules.map((rule) => rule.term);
}

function violations(catalog, markdown = table) {
  return findVocabularyViolations(rulesFor(markdown).rules, [{ file: "locales/renderer/en/test.json", catalog }]);
}

function readRepositoryJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repositoryRoot, relativePath), "utf8"));
}

describe("vocabulary rules come from the Product Philosophy table", () => {
  it("names every prohibited word, in both scripts, without duplicates", () => {
    expect(terms()).toEqual([
      "备份", "Backup", "云盘", "Clone", "Checkout", "Download", "Pull", "Merge", "Diverged",
    ]);
  });

  it("keeps a word the same table sanctions as user-facing wording", () => {
    // `Cloud` is prohibited as a storage-location label and sanctioned as the
    // name of the outward-facing copy; a mechanical ban would contradict itself.
    expect(terms(table.replace("云盘", "云盘，Cloud"))).not.toContain("Cloud");
    expect(rulesFor(table.replace("云盘", "云盘，Cloud")).skipped.map((entry) => entry.term)).toContain("Cloud");
  });

  it("carries the replacement wording and the concept into each rule", () => {
    expect(rulesFor().rules.find((rule) => rule.term === "Diverged")).toEqual({
      term: "Diverged", concept: "别处的改动", userFacing: "*X* made 3 changes",
    });
  });

  it("digests the table alone, so unrelated document edits do not invalidate the rules", () => {
    const edited = `${table}\n本表适合由仓库的本地化检查强制。\n`;
    expect(rulesFor(edited).source.tableDigest).toBe(rulesFor().source.tableDigest);
    expect(rulesFor(table.replace("Diverged", "Diverged，Conflict")).source.tableDigest)
      .not.toBe(rulesFor().source.tableDigest);
  });

  it("records the document provenance of the generated rules", () => {
    expect(rulesFor().source.provenance).toBe(`puppy-issues@abc1234:${documentPath}#vocabulary`);
  });

  it("refuses a document without the table", () => {
    expect(() => rulesFor("# Puppyone Product Philosophy\n")).toThrow(/Vocabulary/);
  });
});

describe("the gate reads user-facing wording only", () => {
  it("reports the prohibited word, its concept and the replacement", () => {
    expect(violations({ "state.diverged": "Diverged" })[0]).toEqual({
      id: "locales/renderer/en/test.json state.diverged Diverged",
      message: 'locales/renderer/en/test.json state.diverged: "Diverged" is system-view wording for 别处的改动;'
        + " say *X* made 3 changes",
    });
  });

  it("asks for a consequence when the concept has no user-facing word", () => {
    expect(violations({ "setup.clone": "Clone the repository" })[0].message)
      .toContain("describe the consequence instead （不出现，隐含）");
  });

  it("catches inflected forms", () => {
    expect(violations({ "sync.pulling": "Pulling changes" })).toHaveLength(1);
    expect(buildVocabularyPattern("Pull").test("Pulls")).toBe(true);
    expect(buildVocabularyPattern("Merge").test("Merged")).toBe(true);
    expect(buildVocabularyPattern("Download").test("Downloading")).toBe(true);
  });

  it("does not match a longer unrelated word", () => {
    expect(violations({ "editor.pullover": "Pullover and merger patterns" })).toHaveLength(0);
  });

  it("ignores placeholder names and links, which the user never reads", () => {
    expect(violations({ "action.label": "Review {pullRequest}" })).toHaveLength(0);
    expect(violations({ "help.link": "See https://example.test/docs/pull-requests" })).toHaveLength(0);
  });

  it("still reads the copy inside plural and select bodies", () => {
    expect(violations({ "sync.count": "{count, plural, one {# Merge} other {# Merges}}" })).toHaveLength(1);
  });

  it("skips values that are not strings", () => {
    expect(violations({ "legacy.count": 3, "legacy.flag": true })).toHaveLength(0);
  });
});

describe("the baseline exempts existing strings and may only shrink", () => {
  const current = [
    { id: "a.json key Pull", message: "a" },
    { id: "b.json key Merge", message: "b" },
  ];

  it("fails only for strings the baseline does not record", () => {
    const result = compareVocabularyBaseline(["a.json key Pull"], current);
    expect(result.added.map((violation) => violation.id)).toEqual(["b.json key Merge"]);
    expect(result.stale).toEqual([]);
  });

  it("reports recorded strings that disappeared so the baseline can shrink", () => {
    const recorded = ["a.json key Pull", "b.json key Merge", "c.json key Clone"];
    const result = compareVocabularyBaseline(recorded, current);
    expect(result.added).toEqual([]);
    expect(result.stale).toEqual(["c.json key Clone"]);
    expect(result.current).toEqual(["a.json key Pull", "b.json key Merge"]);
  });
});

describe("the gate is wired into the repository checks", () => {
  it("runs inside npm run check:boundaries", () => {
    expect(readRepositoryJson("package.json").scripts["check:boundaries"])
      .toContain("node scripts/check-user-vocabulary.mjs");
  });

  it("names the wording authority in the Documentation Authority section", () => {
    const agreement = readFileSync(path.join(repositoryRoot, "AGENTS.md"), "utf8");
    const authority = agreement.split("## Documentation Authority")[1].split(/^## /m)[0];
    expect(authority).toContain("product-philosophy.md");
    expect(authority).toContain("locales/renderer/**");
  });

  it("passes against the whole repository with the committed baseline", () => {
    const result = spawnSync(process.execPath, ["scripts/check-user-vocabulary.mjs"], {
      cwd: repositoryRoot, encoding: "utf8",
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("keeps every exempt string in a catalog that still exists", () => {
    const files = new Set(readRepositoryJson(baselinePath).violations.map((id) => id.split(" ")[0]));
    expect([...files].filter((file) => !existsSync(path.join(repositoryRoot, file)))).toEqual([]);
  });

  it("holds generated rules that still match the authority document when it is checked out", () => {
    const document = path.join(repositoryRoot, "..", "puppy-issues", documentPath);
    if (!existsSync(document)) return;
    expect(readRepositoryJson(rulesPath).source.tableDigest)
      .toBe(deriveVocabularyRules(readFileSync(document, "utf8")).source.tableDigest);
  });
});
