import { describe, expect, it } from "vitest";
import {
  CLOUD_ROUTES,
  getCloudProjectDetailResources,
  getCloudRouteSurface,
} from "../../../../src/features/cloud/routes/cloudRoutes";

describe("Cloud route architecture", () => {
  it("declares one descriptor for every route id", () => {
    const ids = CLOUD_ROUTES.map((route) => route.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CLOUD_ROUTES.every((route) => route.context && route.surface && route.resources)).toBe(true);
  });

  it("keeps route-owned data plans out of the view orchestrator", () => {
    expect(getCloudProjectDetailResources("contents")).toEqual([
      "dashboard",
      "tree",
      "history",
      "scopes",
      "connectors",
      "mcp-endpoints",
      "identity",
    ]);
    expect(getCloudProjectDetailResources("access")).toEqual([
      "scopes",
      "connectors",
      "mcp-endpoints",
      "identity",
    ]);
    expect(getCloudProjectDetailResources("automation")).toEqual(
      getCloudProjectDetailResources("access"),
    );
    expect(getCloudProjectDetailResources("cli")).toEqual(
      getCloudProjectDetailResources("access"),
    );
    expect(getCloudProjectDetailResources("git-sync")).toEqual(
      getCloudProjectDetailResources("access"),
    );
    expect(getCloudProjectDetailResources("history")).toEqual([]);
    expect(getCloudProjectDetailResources("settings")).toEqual([]);
  });

  it("declares the shell surface alongside each route", () => {
    expect(getCloudRouteSurface("contents")).toBe("landing");
    expect(getCloudRouteSurface("access")).toBe("landing");
    expect(getCloudRouteSurface("settings")).toBe("landing");
    expect(getCloudRouteSurface("history")).toBe("history");
    expect(getCloudRouteSurface("automation")).toBe("automation");
    expect(getCloudRouteSurface("cloud-team")).toBe("standard");
  });
});
