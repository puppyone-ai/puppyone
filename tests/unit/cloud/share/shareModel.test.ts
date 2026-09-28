import { describe, expect, it } from "vitest";
import type { DesktopCloudDashboard, DesktopCloudMcpEndpoint } from "../../../../src/lib/cloudApi";
import {
  buildMcpServerUrl,
  buildProjectShares,
  buildShareHandoff,
  getShareTarget,
  isActiveShare,
  isPendingShareLive,
  isShareTargetId,
  maskApiKey,
  normalizeApiOrigin,
  resolveCloudShareStatus,
  SHARE_TARGETS,
  shareHasReceipt,
  shareTargetHandoffStepKey,
  shareTargetLabelKey,
  shareTargetPreviewKey,
} from "../../../../src/features/cloud/share";
import { projectRootTarget } from "../../../../src/features/cloud/repositoryTarget";
import {
  CLOUD_BOUND_PROJECT_SIDEBAR_ROUTES,
  CLOUD_PROJECT_SIDEBAR_ROUTES,
  getCloudRoute,
  withSharePageSidebarRoutes,
} from "../../../../src/features/cloud/routes/cloudRoutes";
import englishCloud from "../../../../locales/renderer/en/cloud.json";

const endpoint: DesktopCloudMcpEndpoint = {
  id: "ep-1",
  project_id: "proj-1",
  path: "",
  name: "Viktor",
  api_key: "mcp_live_0123456789abcdef",
  api_key_hint: "mcp_…cdef",
  status: "active",
  accesses: [{ path: "", json_path: "", readonly: true }],
  created_at: "2026-09-28T10:00:00Z",
};

function dashboardWith(connections: DesktopCloudDashboard["connections"]): DesktopCloudDashboard {
  return {
    project: { id: "proj-1", name: "Notes" },
    nodes: { total: 0, folders: 0, files: 0 },
    connections,
    tools: [],
  } as unknown as DesktopCloudDashboard;
}

describe("share targets", () => {
  it("covers cloud Agents over MCP and chat bots or people over a link", () => {
    const ids = SHARE_TARGETS.map((target) => target.id);
    expect(ids).toEqual(["viktor", "claude", "chatgpt", "slack-bot", "grok", "person", "mcp"]);
    expect(getShareTarget("viktor").channel).toBe("mcp");
    expect(getShareTarget("slack-bot").channel).toBe("link");
    expect(getShareTarget("person").channel).toBe("link");
    expect(isShareTargetId("grok")).toBe(true);
    expect(isShareTargetId("cursor")).toBe(false);
  });

  it("names every localized message it will ask for", () => {
    const keys = new Set(Object.keys(englishCloud).map((key) => `cloud.${key}`));
    for (const target of SHARE_TARGETS) {
      expect(keys.has(shareTargetLabelKey(target.id))).toBe(true);
      expect(keys.has(shareTargetPreviewKey(target.id))).toBe(true);
      for (let step = 1; step <= target.handoffSteps; step += 1) {
        expect(keys.has(shareTargetHandoffStepKey(target.id, step))).toBe(true);
      }
    }
  });
});

describe("share handoff", () => {
  it("builds the hosted MCP server URL from the desktop API base", () => {
    expect(normalizeApiOrigin("https://cloud.example/api/v1")).toBe("https://cloud.example");
    expect(normalizeApiOrigin("https://cloud.example")).toBe("https://cloud.example");
    expect(normalizeApiOrigin(null)).toBe("");
    expect(buildMcpServerUrl("https://cloud.example/api/v1", "mcp_key")).toBe(
      "https://cloud.example/api/v1/mcp/server/mcp_key",
    );
    expect(buildMcpServerUrl("https://cloud.example", null)).toBe("");
  });

  it("gives MCP targets a paste-ready URL and link targets the project link", () => {
    const mcp = buildShareHandoff({
      target: getShareTarget("viktor"),
      endpoint,
      apiBaseUrl: "https://cloud.example/api/v1",
      projectLink: "https://cloud.example/projects/proj-1",
    });
    expect(mcp).toEqual({
      channel: "mcp",
      serverUrl: "https://cloud.example/api/v1/mcp/server/mcp_live_0123456789abcdef",
      apiKey: "mcp_live_0123456789abcdef",
      apiKeyHint: "mcp_…cdef",
    });

    const link = buildShareHandoff({
      target: getShareTarget("slack-bot"),
      endpoint: null,
      apiBaseUrl: "https://cloud.example/api/v1",
      projectLink: "https://cloud.example/projects/proj-1",
    });
    expect(link).toEqual({ channel: "link", url: "https://cloud.example/projects/proj-1" });
    expect(buildShareHandoff({
      target: getShareTarget("viktor"),
      endpoint: null,
      apiBaseUrl: "https://cloud.example/api/v1",
      projectLink: null,
    })).toBeNull();
  });

  it("never prints a full key when only a hint is available", () => {
    expect(maskApiKey(null, "mcp_…cdef")).toBe("mcp_…cdef");
    expect(maskApiKey("mcp_live_0123456789abcdef", null)).toBe("mcp_••••cdef");
    expect(maskApiKey("short", null)).toBe("••••");
  });
});

describe("project shares", () => {
  it("joins endpoints with dashboard usage to show who has actually connected", () => {
    const shares = buildProjectShares(
      [endpoint, { ...endpoint, id: "ep-2", name: "Claude", accesses: [{ path: "docs", readonly: false }] }],
      dashboardWith([{ id: "ep-2", provider: "mcp", status: "active", last_synced_at: "2026-09-28T11:00:00Z" }]),
    );
    expect(shares).toHaveLength(2);
    expect(shares[0]).toMatchObject({ id: "ep-1", path: "", readonly: true, lastSeenAt: null });
    expect(shares[1]).toMatchObject({ id: "ep-2", path: "docs", readonly: false, lastSeenAt: "2026-09-28T11:00:00Z" });
  });

  it("only counts usage after the share was issued as a receipt", () => {
    const [share] = buildProjectShares(
      [endpoint],
      dashboardWith([{ id: "ep-1", provider: "mcp", status: "active", last_synced_at: "2026-09-28T11:00:00Z" }]),
    );
    expect(shareHasReceipt(share, "2026-09-28T10:30:00Z")).toBe(true);
    expect(shareHasReceipt(share, "2026-09-28T11:30:00Z")).toBe(false);
    expect(shareHasReceipt(share, null)).toBe(true);
    expect(shareHasReceipt({ ...share, lastSeenAt: null }, null)).toBe(false);
    expect(shareHasReceipt(null, null)).toBe(false);
  });
});

describe("Share sidebar route", () => {
  it("keeps Homepage first and slots Share after it without touching the stable contract", () => {
    expect(CLOUD_PROJECT_SIDEBAR_ROUTES.map((route) => route.id)).toEqual(["contents", "mcp", "cli", "automation"]);
    expect(getCloudRoute("share").showInSidebar).toBe(false);
    expect(getCloudRoute("share").navigationGroup).toBe("project");
    const shareRoutes = withSharePageSidebarRoutes(CLOUD_BOUND_PROJECT_SIDEBAR_ROUTES);
    const ids = shareRoutes.map((route) => route.id);
    expect(ids.slice(0, 3)).toEqual(["contents", "share", "mcp"]);
    expect(shareRoutes[0]?.labelId).toBe("cloud.route.contents.label");
    expect(shareRoutes[1]?.labelId).toBe("cloud.share.location.shareAction");
    expect(CLOUD_BOUND_PROJECT_SIDEBAR_ROUTES[0]?.labelId).toBe("cloud.route.contents.label");
    expect(ids.filter((id) => id === "share")).toHaveLength(1);
    expect(withSharePageSidebarRoutes(withSharePageSidebarRoutes(CLOUD_BOUND_PROJECT_SIDEBAR_ROUTES)).map((route) => route.id))
      .toEqual(ids);
  });
});

describe("share status", () => {
  const resolved = {
    status: "resolved" as const,
    projectId: "proj-1",
    target: projectRootTarget("proj-1"),
  };
  const [share] = buildProjectShares([endpoint], null);
  const pending = { targetId: "viktor" as const, endpointId: "ep-1", issuedAt: "2026-09-28T10:00:00Z" };
  const kind = (options: Partial<Parameters<typeof resolveCloudShareStatus>[0]>) => resolveCloudShareStatus({
    context: resolved,
    shares: [],
    signedIn: true,
    pending: null,
    ...options,
  }).kind;

  it("tells local, signed-out, published, shared, and attention apart", () => {
    expect(kind({ context: { status: "local-only", projectId: null }, signedIn: false })).toBe("local");
    expect(kind({ context: { status: "resolving", projectId: null } })).toBe("resolving");
    expect(kind({ sharesLoaded: false })).toBe("resolving");
    expect(kind({})).toBe("published");
    expect(kind({ shares: [share] })).toBe("shared");
    expect(kind({ shares: [{ ...share, status: "disabled" }] })).toBe("published");
    expect(kind({
      context: { status: "wrong-account", projectId: "proj-1", message: { code: "remote-sign-in" } },
      signedIn: false,
    })).toBe("signed-out");
    const attention = resolveCloudShareStatus({
      context: { status: "not-authorized", projectId: "proj-1", message: { code: "workspace-unavailable" } },
      shares: [share],
      signedIn: true,
      pending: null,
    });
    expect(attention.kind).toBe("attention");
    expect(attention.message).toEqual({ code: "workspace-unavailable" });
  });

  it("waits only while the issued share exists and has not been read since it was issued", () => {
    expect(kind({ shares: [share], pending })).toBe("waiting");
    expect(isPendingShareLive(pending, [share])).toBe(true);
    const readBefore = { ...share, lastSeenAt: "2026-09-28T09:00:00Z" };
    expect(kind({ shares: [readBefore], pending })).toBe("waiting");
    const readAfter = { ...share, lastSeenAt: "2026-09-28T10:01:00Z" };
    expect(kind({ shares: [readAfter], pending })).toBe("shared");
    expect(kind({ shares: [], pending })).toBe("published");
    expect(kind({ shares: [{ ...share, status: "disabled" }], pending })).toBe("published");
    expect(isActiveShare({ ...share, status: "disabled" })).toBe(false);
  });
});
