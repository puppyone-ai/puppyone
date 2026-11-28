import { describe, expect, it } from "vitest";
import {
  appendWorkspaceContentChange,
  createResourceUri,
  createWorkspaceResourceUri,
  MAX_WORKSPACE_CONTENT_CHANGE_ENTRIES,
  type DataNode,
  type ResourceUri,
  type WorkspaceContentChange,
} from "@puppyone/shared-ui";
import { planExplorerRefresh } from "../../../../src/shared-ui/data/explorer/explorerRefreshScope";

const root = createResourceUri({ scheme: "puppyone-cloud", authority: "api.example", path: "https/api/v1/owner/project/root" });
const other = createResourceUri({ scheme: "puppyone-local", authority: "workspace", path: "other" });
const at = (path: string, base: ResourceUri = root) => createWorkspaceResourceUri(base, path);
const file = (path: string, base: ResourceUri = root): DataNode => ({ id: at(path, base), path: at(path, base), name: path.split("/").at(-1)!, type: "markdown" });
const folder = (path: string, children: DataNode[] | null, base: ResourceUri = root): DataNode =>
  ({ id: at(path, base), path: at(path, base), name: path.split("/").at(-1)!, type: "folder", children });

/** Single-Folder tree: the root lists directly, `docs` and `docs/deep` loaded, `archive` never opened. */
const tree: DataNode[] = [
  file("readme.md"),
  folder("docs", [file("docs/guide.md"), folder("docs/deep", [file("docs/deep/note.md")])]),
  folder("archive", null),
];
const changed = (...entries: { rootUri: ResourceUri | null; paths: readonly string[] | null }[]) =>
  entries.reduce<WorkspaceContentChange>((journal, entry) => appendWorkspaceContentChange(journal, entry), { sequence: 0, entries: [] });

describe("explorer refresh scope", () => {
  it("re-lists only the parent folder of a changed file", () => {
    expect(planExplorerRefresh(changed({ rootUri: root, paths: ["docs/guide.md"] }), 0, tree))
      .toEqual({ kind: "folders", folders: [at("docs")] });
  });

  it("re-lists the unnamed root for a top-level change in a single-Folder tree", () => {
    expect(planExplorerRefresh(changed({ rootUri: root, paths: ["readme.md"] }), 0, tree))
      .toEqual({ kind: "folders", folders: [null] });
  });

  it("re-lists a changed folder that is loaded, together with its parent", () => {
    expect(planExplorerRefresh(changed({ rootUri: root, paths: ["docs/deep"] }), 0, tree))
      .toEqual({ kind: "folders", folders: [at("docs/deep"), at("docs")] });
  });

  it("re-lists the nearest loaded ancestor for a change inside a folder that was never opened", () => {
    expect(planExplorerRefresh(changed({ rootUri: root, paths: ["archive/2024/report.md"] }), 0, tree))
      .toEqual({ kind: "folders", folders: [null] });
  });

  it("names each folder once for a batch", () => {
    const plan = planExplorerRefresh(changed(
      { rootUri: root, paths: ["docs/guide.md", "docs/new.md"] },
      { rootUri: root, paths: ["docs/deep/note.md"] },
    ), 0, tree);
    expect(plan).toEqual({ kind: "folders", folders: [at("docs"), at("docs/deep")] });
  });

  it("uses the Folder row as the root of a multi-Folder tree", () => {
    const multi: DataNode[] = [
      { id: root, path: root, name: "Cloud", type: "folder", children: tree, workspaceFolderRoot: true },
      { id: other, path: other, name: "Local", type: "folder", children: [file("a.md", other)], workspaceFolderRoot: true },
    ];
    expect(planExplorerRefresh(changed({ rootUri: other, paths: ["a.md"] }), 0, multi))
      .toEqual({ kind: "folders", folders: [other] });
  });

  it("only considers entries newer than the last processed sequence", () => {
    const journal = changed({ rootUri: root, paths: ["docs/guide.md"] }, { rootUri: root, paths: ["readme.md"] });
    expect(planExplorerRefresh(journal, 1, tree)).toEqual({ kind: "folders", folders: [null] });
    expect(planExplorerRefresh(journal, 2, tree)).toEqual({ kind: "none" });
  });

  it.each([
    ["an unscoped change", changed({ rootUri: root, paths: null })],
    ["a change without a root", changed({ rootUri: null, paths: ["readme.md"] })],
    ["a newer sequence that names nothing", { sequence: 3, entries: [] }],
  ])("refreshes everything for %s", (_label, journal) => {
    expect(planExplorerRefresh(journal as WorkspaceContentChange, 0, tree)).toEqual({ kind: "all" });
  });

  it("refreshes everything when the journal moved backwards or dropped entries the consumer never saw", () => {
    expect(planExplorerRefresh(changed({ rootUri: root, paths: ["readme.md"] }), 5, tree)).toEqual({ kind: "all" });
    let journal: WorkspaceContentChange = { sequence: 0, entries: [] };
    for (let index = 0; index <= MAX_WORKSPACE_CONTENT_CHANGE_ENTRIES + 1; index++) {
      journal = appendWorkspaceContentChange(journal, { rootUri: root, paths: [`docs/${index}.md`] });
    }
    expect(planExplorerRefresh(journal, 0, tree)).toEqual({ kind: "all" });
    expect(planExplorerRefresh(journal, journal.sequence - 1, tree)).toEqual({ kind: "folders", folders: [at("docs")] });
  });
});
