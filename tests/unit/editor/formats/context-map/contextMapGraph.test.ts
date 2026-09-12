import { describe, expect, it } from "vitest";
import type { DataNode, DataPort, MarkdownBacklink } from "@puppyone/shared-ui";
import {
  aggregateFolderRelationshipEdges,
  buildFolderRelationshipProjection,
  loadFolderRelationshipGraph,
  type FolderRelationshipGraph,
} from "../../../../../packages/shared-ui/src/editor/viewers/context-map/contextMapGraph";

describe("aggregateFolderRelationshipEdges", () => {
  it("collapses document backlinks into one direct edge between visible folders", () => {
    const bucketByPath = new Map([
      ["civil/contract.md", "civil"],
      ["civil/property.md", "civil"],
      ["criminal/fraud.md", "criminal"],
    ]);
    const backlinks: Array<[string, MarkdownBacklink[]]> = [
      ["criminal/fraud.md", [{
        sourcePath: "civil/contract.md",
        sourceName: "contract.md",
        count: 2,
        references: [],
      }]],
      ["civil/contract.md", [
        {
          sourcePath: "criminal/fraud.md",
          sourceName: "fraud.md",
          count: 1,
          references: [],
        },
        {
          sourcePath: "civil/property.md",
          sourceName: "property.md",
          count: 5,
          references: [],
        },
      ]],
    ];

    expect(aggregateFolderRelationshipEdges(backlinks, bucketByPath)).toEqual([{
      sourceId: "civil",
      targetId: "criminal",
      count: 3,
      bidirectional: true,
    }]);
  });

  it("keeps one-way cross-folder links and ignores links inside one folder", () => {
    const bucketByPath = new Map([
      ["a/one.md", "a"],
      ["a/two.md", "a"],
      ["b/three.md", "b"],
    ]);
    const backlinks: Array<[string, MarkdownBacklink[]]> = [["b/three.md", [
      { sourcePath: "a/one.md", sourceName: "one.md", count: 1, references: [] },
    ]], ["a/two.md", [
      { sourcePath: "a/one.md", sourceName: "one.md", count: 4, references: [] },
    ]]];

    expect(aggregateFolderRelationshipEdges(backlinks, bucketByPath)).toEqual([{
      sourceId: "a",
      targetId: "b",
      count: 1,
      bidirectional: false,
    }]);
  });

  it("preserves a one-way relationship whose source sorts after its target", () => {
    const bucketByPath = new Map([
      ["alpha.md", "alpha.md"],
      ["zebra.md", "zebra.md"],
    ]);
    const backlinks: Array<[string, MarkdownBacklink[]]> = [["alpha.md", [{
      sourcePath: "zebra.md",
      sourceName: "zebra.md",
      count: 2,
      references: [],
    }]]];

    expect(aggregateFolderRelationshipEdges(backlinks, bucketByPath)).toEqual([{
      sourceId: "zebra.md",
      targetId: "alpha.md",
      count: 2,
      bidirectional: false,
    }]);
  });
});

describe("buildFolderRelationshipProjection", () => {
  it("keeps the root context while moving links onto an expanded folder's children", () => {
    const civil = folder("civil");
    const criminal = folder("criminal");
    const contract = file("civil/contract.md");
    const property = file("civil/property.md");
    const fraud = file("criminal/fraud.md");
    const graph: FolderRelationshipGraph = {
      folder: folder("law"),
      rootNodes: [civil, criminal],
      childrenByFolderPath: new Map([
        ["civil", [contract, property]],
        ["criminal", [fraud]],
      ]),
      documentNodes: [contract, property, fraud],
      backlinks: [
        ["criminal/fraud.md", [{
          sourcePath: "civil/contract.md",
          sourceName: "contract.md",
          count: 2,
          references: [],
        }]],
        ["civil/contract.md", [
          {
            sourcePath: "criminal/fraud.md",
            sourceName: "fraud.md",
            count: 1,
            references: [],
          },
          {
            sourcePath: "civil/property.md",
            sourceName: "property.md",
            count: 5,
            references: [],
          },
        ]],
      ],
      indexedDocumentCount: 3,
      scannedFileCount: 3,
      truncated: false,
    };

    expect(buildFolderRelationshipProjection(graph, new Set()).edges).toEqual([{
      sourceId: "civil",
      targetId: "criminal",
      count: 3,
      bidirectional: true,
    }]);

    const expanded = buildFolderRelationshipProjection(graph, new Set(["civil"]));
    expect(expanded.edges).toEqual([
      {
        sourceId: "civil/property.md",
        targetId: "civil/contract.md",
        count: 5,
        bidirectional: false,
      },
      {
        sourceId: "civil/contract.md",
        targetId: "criminal",
        count: 3,
        bidirectional: true,
      },
    ]);
    expect([...expanded.relationshipCountByNode.entries()]).toEqual([
      ["civil/property.md", 5],
      ["civil/contract.md", 8],
      ["criminal", 3],
    ]);
  });
});

describe("loadFolderRelationshipGraph", () => {
  it("scans a workspace-root scope and never includes Context Map documents in their own graph", async () => {
    const requestedFolders: Array<string | null> = [];
    const dataPort: DataPort = {
      listChildren: async (path) => {
        requestedFolders.push(path);
        if (path === null) {
          return [
            folder("law"),
            { ...file("Knowledge.contextmap"), type: "context-map" },
            file("README.md"),
          ];
        }
        if (path === "law") {
          return [file("law/civil.md"), { ...file("law/Detail.contextmap"), type: "context-map" }];
        }
        return [];
      },
    };

    const graph = await loadFolderRelationshipGraph({
      dataPort,
      folder: folder(""),
    });

    expect(requestedFolders).toEqual([null, "law"]);
    expect(graph.rootNodes.map((node) => node.path)).toEqual(["law", "README.md"]);
    expect(graph.documentNodes.map((node) => node.path)).toEqual(["law/civil.md", "README.md"]);
  });
});

function folder(path: string): DataNode {
  return {
    id: path,
    path,
    name: path.split("/").at(-1) ?? path,
    type: "folder",
    source: "local",
  };
}

function file(path: string): DataNode {
  return {
    id: path,
    path,
    name: path.split("/").at(-1) ?? path,
    type: "markdown",
    source: "local",
  };
}
