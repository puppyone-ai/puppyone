import { describe, expect, it } from "vitest";
import type {
  DesktopCloudConnector,
  DesktopCloudMcpEndpoint,
  DesktopCloudRepoIdentity,
  DesktopCloudScope,
} from "../../../../src/lib/cloudApi";
import {
  buildAccessPointProjection,
  normalizeAccessPointStatus,
  resolveAccessPointKind,
  selectAccessPointRows,
} from "../../../../src/features/cloud/access-points/model";

describe("Access Point domain", () => {
  it("normalizes provider aliases at the adapter boundary", () => {
    expect(resolveAccessPointKind("filesystem")).toBe("git");
    expect(resolveAccessPointKind("git_remote")).toBe("git");
    expect(resolveAccessPointKind("mcp_endpoint")).toBe("mcp");
    expect(resolveAccessPointKind("remote_workspace")).toBe("vm");
    expect(resolveAccessPointKind("future_link_provider")).toBe("custom");
  });

  it("represents provider status as a closed UI state", () => {
    expect(normalizeAccessPointStatus("active")).toEqual({ kind: "ready", code: "active" });
    expect(normalizeAccessPointStatus("connecting")).toEqual({ kind: "syncing", code: "connecting" });
    expect(normalizeAccessPointStatus("failed")).toEqual({ kind: "error", code: "failed" });
    expect(normalizeAccessPointStatus(undefined)).toEqual({ kind: "missing", code: "missing" });
  });

  it("builds typed rows and adds only the placeholder requested by the route", () => {
    const all = buildAccessPointProjection({
      scopes: SCOPES,
      connectors: CONNECTORS,
      mcpEndpoints: [],
      identity: IDENTITY,
      apiBaseUrl: null,
      catalogKind: "all",
    });
    const mcp = buildAccessPointProjection({
      scopes: SCOPES,
      connectors: CONNECTORS,
      mcpEndpoints: [],
      identity: IDENTITY,
      apiBaseUrl: null,
      catalogKind: "mcp",
    });

    expect(all.accessPointRows.map((row) => row.accessPoint.kind)).toEqual(["cli", "git", "cli", "git"]);
    expect(mcp.accessPointRows.filter((row) => row.accessPoint.kind === "mcp")).toHaveLength(2);
    expect(mcp.accessPointRows.filter((row) => row.accessPoint.placeholder)).toHaveLength(2);
  });

  it("filters standardized rows without reading provider aliases", () => {
    const projection = buildAccessPointProjection({
      scopes: SCOPES,
      connectors: CONNECTORS,
      mcpEndpoints: MCP_ENDPOINTS,
      identity: IDENTITY,
      apiBaseUrl: null,
    });
    const rows = selectAccessPointRows({
      rows: projection.accessPointRows,
      kind: "mcp",
      status: "active",
      query: "docs",
      locale: "en",
      getSearchText: (row) => `${row.accessPoint.title} ${row.scope.name}`,
    });
    expect(rows.map((row) => row.accessPoint.id)).toEqual(["mcp:mcp-docs"]);
  });
});

const IDENTITY = {
  project_id: "project-1",
  url: "https://cloud.example/git/project-1.git",
  scopes: [{
    id: "scope-docs",
    name: "Documentation",
    path: "docs",
    git_url: "https://cloud.example/git/project-1/scopes/scope-docs.git",
  }],
} satisfies DesktopCloudRepoIdentity;

const SCOPES = [{
  id: "scope-docs",
  project_id: "project-1",
  name: "Documentation",
  path: "docs",
  exclude: [],
  max_mode: "r",
}] satisfies DesktopCloudScope[];

const CONNECTORS = [{
  id: "docs-cli",
  target: { kind: "scope", project_id: "project-1", scope_id: "scope-docs" },
  provider: "cli",
  name: "Docs CLI",
  direction: "bidirectional",
  status: "active",
}] satisfies DesktopCloudConnector[];

const MCP_ENDPOINTS = [{
  id: "mcp-docs",
  project_id: "project-1",
  path: "docs",
  name: "Docs MCP",
  status: "active",
  accesses: [{ path: "docs", readonly: true }],
}] satisfies DesktopCloudMcpEndpoint[];
