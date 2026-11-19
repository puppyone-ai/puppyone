/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { desktopPreferencesStore } from "../../../../src/preferencesStore";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import type { AgentActivityEnrollmentSnapshot } from "../../../../shared/agent-activity-contract/types";
import { LOCAL_AGENT_INSTALLATION_IDS } from "../../../../shared/local-agent-installation/types";
import { notesProject, renderHome, setUpOnboardingHome } from "../../../support/react/onboardingHome";
import { stripBidiIsolation } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
setUpOnboardingHome();

function discoverySnapshot(
  foundAgentIds: readonly string[],
  extraResults: Array<{ agentId: string; status: "not-found" | "failed" }> = [],
) {
  const foundSet = new Set(foundAgentIds);
  const orderedFound = LOCAL_AGENT_INSTALLATION_IDS.filter((id) => foundSet.has(id));
  const extraById = new Map(extraResults.map((entry) => [entry.agentId, entry.status] as const));
  const results = LOCAL_AGENT_INSTALLATION_IDS
    .filter((id) => foundSet.has(id) || extraById.has(id))
    .map((agentId) => {
      if (foundSet.has(agentId)) {
        return {
          agentId,
          displayName: agentId,
          status: "found" as const,
          source: "fixture",
        };
      }
      const status = extraById.get(agentId)!;
      return {
        agentId,
        displayName: agentId,
        status,
        source: "fixture",
        ...(status === "failed" ? { reasonCode: "probe-error" as const } : {}),
      };
    });

  return {
    schemaVersion: 1 as const,
    generation: 1,
    scanId: "scan-1",
    availableAgentIds: orderedFound,
    requestedAt: "2026-04-01T00:00:00.000Z",
    completedAt: "2026-04-01T00:00:01.000Z",
    source: "scan" as const,
    results,
  };
}

function enrollmentSnapshot(enabledProviderIds: readonly string[]): AgentActivityEnrollmentSnapshot {
  return {
    schemaVersion: 1,
    providers: ["claude", "codex", "cursor"].map((providerId) => ({
      providerId,
      displayName: providerId,
      configurable: true,
      enrollment: enabledProviderIds.includes(providerId) ? "enabled" : "not-configured",
    })),
  };
}

const TEST_CLOUD_API_BASE = "https://cloud-fixture.puppyone.ai/api/v1";

const TEST_CLOUD_SESSION: DesktopCloudSession = {
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user_id: "user-1",
  user_email: "owner@example.com",
  api_base_url: TEST_CLOUD_API_BASE,
  session_generation: "1",
  status: "authenticated",
};

function cloudOk<T>(data: T) {
  return {
    transport: "puppyone-cloud-ipc-v1" as const,
    ok: true as const,
    data,
  };
}

function cloudForbidden() {
  return {
    transport: "puppyone-cloud-ipc-v1" as const,
    ok: false as const,
    error: {
      status: 403,
      message: "Forbidden",
    },
  };
}

describe("HomepageAgentStrip", () => {
  it("lists only found, unhidden, chat-capable local Agents, marks Hook enrollment, and opens Settings from Connect", async () => {
    desktopPreferencesStore.getState().setLocalAgentsSettings((current) => ({
      ...current,
      hiddenTerminalAgentIds: ["opencode"],
    }));

    Object.defineProperty(window, "puppyoneDesktop", {
      configurable: true,
      value: {
        discoverLocalAgentInstallations: vi.fn(async () => discoverySnapshot(
          ["claude", "codex", "opencode"],
          [
            { agentId: "cursor", status: "not-found" },
            { agentId: "pi", status: "failed" },
          ],
        )),
        onLocalAgentInstallationProgress: vi.fn(() => () => undefined),
        onLocalAgentInstallationsChanged: vi.fn(() => () => undefined),
        getAgentActivityEnrollment: vi.fn(async () => enrollmentSnapshot(["claude"])),
      },
    });

    const onOpenAgentSettings = vi.fn();
    const container = renderHome({
      projectItems: [notesProject],
      onOpenAgentSettings,
      cloudSession: null,
      cloudSpaces: [],
    });

    await vi.waitFor(() => {
      expect(container.querySelectorAll("[data-agent-place='local'] .onboarding-agent")).toHaveLength(2);
    });

    const localButtons = [...container.querySelectorAll<HTMLButtonElement>("[data-agent-place='local'] .onboarding-agent")];
    const runtimes = localButtons.map((button) => button.dataset.agentRuntime);
    expect(new Set(runtimes)).toEqual(new Set(["claude", "codex"]));
    expect(runtimes).not.toContain("puppyone-agent");

    const claudeButton = localButtons.find((button) => button.dataset.agentRuntime === "claude")!;
    const codexButton = localButtons.find((button) => button.dataset.agentRuntime === "codex")!;
    // Logo-only strip: no inline Agent or group text labels on the bar; hover tooltips carry the names.
    expect(container.querySelector(".onboarding-agent-name")).toBeNull();
    expect(container.querySelector(".onboarding-agent-group-label")).toBeNull();
    expect(claudeButton.textContent).toBe("");
    expect(codexButton.textContent).toBe("");
    expect(claudeButton.querySelector(".onboarding-agent-brand")).not.toBeNull();
    expect(codexButton.querySelector(".onboarding-agent-brand")).not.toBeNull();
    expect(stripBidiIsolation(claudeButton.dataset.tooltip ?? ""))
      .toBe("Claude Code · Set up for puppyone");
    expect(stripBidiIsolation(codexButton.dataset.tooltip ?? ""))
      .toBe("Codex");
    expect(claudeButton.querySelector(".onboarding-agent-connected")).not.toBeNull();
    expect(codexButton.querySelector(".onboarding-agent-connected")).toBeNull();

    // Signed out: Cloud group must not appear at all.
    expect(container.querySelector("[data-agent-place='cloud']")).toBeNull();

    const connectButton = container.querySelector<HTMLButtonElement>(".onboarding-agent-connect");
    expect(connectButton?.textContent).toBe("");
    expect(connectButton?.getAttribute("aria-label")).toBe("Add");
    expect(connectButton?.dataset.tooltip).toBe("Add");
    await act(async () => connectButton?.click());
    expect(onOpenAgentSettings).toHaveBeenCalledOnce();
  });

  it("keeps five installed local Agents as logo-only marks with hover tooltips and zero inline text", async () => {
    Object.defineProperty(window, "puppyoneDesktop", {
      configurable: true,
      value: {
        discoverLocalAgentInstallations: vi.fn(async () => discoverySnapshot(
          ["claude", "codex", "cursor", "pi", "workbuddy-china"],
        )),
        onLocalAgentInstallationProgress: vi.fn(() => () => undefined),
        onLocalAgentInstallationsChanged: vi.fn(() => () => undefined),
        getAgentActivityEnrollment: vi.fn(async () => enrollmentSnapshot(["claude", "codex"])),
      },
    });

    const container = renderHome({
      projectItems: [notesProject],
      onDefaultProjectLocation: vi.fn(async () => ({ grantId: "grant-1", path: "/Users/example/Projects" })),
      onChooseProjectLocation: vi.fn(async () => ({ grantId: "grant-1", path: "/Users/example/Projects" })),
      onCreateProject: vi.fn(),
      onOpenAgentSettings: vi.fn(),
      cloudSession: null,
      cloudSpaces: [],
    });

    await vi.waitFor(() => {
      expect(container.querySelectorAll("[data-agent-place='local'] .onboarding-agent")).toHaveLength(5);
    });

    const buttons = [...container.querySelectorAll<HTMLButtonElement>("[data-agent-place='local'] .onboarding-agent")];
    expect(buttons.every((button) => button.textContent === "")).toBe(true);
    expect(buttons.every((button) => button.querySelector(".onboarding-agent-brand") !== null)).toBe(true);
    expect(buttons.map((button) => stripBidiIsolation(button.dataset.tooltip ?? ""))).toEqual(
      expect.arrayContaining([
        "Have Claude Code start a project · Set up for puppyone",
        "Have Codex start a project · Set up for puppyone",
        "Have Cursor start a project",
        "Have Pi start a project",
        "Have WorkBuddy (China) start a project",
      ]),
    );
  });

  it("hides the Cloud Agent group when the personal space has no Cloud projects", async () => {
    const requestCloudSessionApi = vi.fn();
    Object.defineProperty(window, "puppyoneDesktop", {
      configurable: true,
      value: { requestCloudSessionApi },
    });

    const container = renderHome({
      projectItems: [
        notesProject,
        {
          id: "cloud:team-project",
          label: "Team Space Doc",
          localPath: "",
          cloudProjectId: "team-proj-1",
          cloudOrganizationId: "org-team",
          lastOpenedAt: "2026-04-01T00:00:00.000Z",
        },
      ],
      cloudSession: TEST_CLOUD_SESSION,
      cloudApiBaseUrl: TEST_CLOUD_API_BASE,
      cloudSpaces: [
        { id: "org-personal", name: "My Space", kind: "space", role: "owner", isDefault: true, canCreateProjects: true },
        { id: "org-team", name: "Team", kind: "space", role: "member", isDefault: false, canCreateProjects: true },
      ],
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector("[data-agent-place='cloud']")).toBeNull();
    const agentLinkCalls = requestCloudSessionApi.mock.calls.filter(([req]) => String(req?.path ?? "").includes("/agent-links"));
    expect(agentLinkCalls).toHaveLength(0);
  });

  it("loads personal-space Cloud Agents on mount and window focus only, deduplicates by name+avatar, skips 403, and places faces on Cloud tiles only", async () => {
    desktopPreferencesStore.getState().setHomepageProjectLayout("grid");
    const nowMs = Date.now();
    const tenMinutesAgo = new Date(nowMs - 10 * 60_000).toISOString();
    const twoMinutesAgo = new Date(nowMs - 2 * 60_000).toISOString();

    const requestCloudSessionApi = vi.fn(async (request: { path: string }) => {
      const { path } = request;
      if (path === "/projects/proj-forbidden/agent-links" || path === "/projects/proj-forbidden/access/sessions") {
        return cloudForbidden();
      }
      if (path === "/projects/proj-a/agent-links") {
        return cloudOk({
          links: [],
          connections: [
            {
              id: "conn-1",
              name: "ChatGPT",
              avatar: "chatgpt",
              admission: "sign_in",
              grant_id: "grant-1",
              connected_at: tenMinutesAgo,
              expires_at: null,
            },
            {
              id: "conn-2",
              name: "Manus",
              avatar: "manus",
              admission: "link",
              grant_id: "grant-2",
              connected_at: tenMinutesAgo,
              expires_at: null,
            },
          ],
        });
      }
      if (path === "/projects/proj-a/access/sessions") {
        return cloudOk([
          {
            grant_id: "grant-1",
            state: "closed",
            created_at: tenMinutesAgo,
            closed_at: tenMinutesAgo,
            lease_until: tenMinutesAgo,
            last_command_at: tenMinutesAgo,
          },
        ]);
      }
      if (path === "/projects/proj-b/agent-links") {
        return cloudOk({
          links: [],
          connections: [
            {
              id: "conn-3",
              name: "ChatGPT",
              avatar: "chatgpt",
              admission: "sign_in",
              grant_id: "grant-3",
              connected_at: twoMinutesAgo,
              expires_at: null,
            },
          ],
        });
      }
      if (path === "/projects/proj-b/access/sessions") {
        return cloudOk([
          {
            grant_id: "grant-3",
            state: "active",
            created_at: twoMinutesAgo,
            closed_at: null,
            lease_until: new Date(nowMs + 300_000).toISOString(),
            last_command_at: twoMinutesAgo,
          },
        ]);
      }
      return cloudOk({ items: [] });
    });

    Object.defineProperty(window, "puppyoneDesktop", {
      configurable: true,
      value: { requestCloudSessionApi },
    });

    const container = renderHome({
      projectItems: [
        notesProject,
        {
          id: "cloud:proj-a",
          label: "revenue",
          localPath: "",
          cloudProjectId: "proj-a",
          cloudOrganizationId: "org-personal",
          lastOpenedAt: twoMinutesAgo,
        },
        {
          id: "cloud:proj-b",
          label: "weekly",
          localPath: "",
          cloudProjectId: "proj-b",
          cloudOrganizationId: "org-personal",
          lastOpenedAt: tenMinutesAgo,
        },
        {
          id: "cloud:proj-forbidden",
          label: "restricted",
          localPath: "",
          cloudProjectId: "proj-forbidden",
          cloudOrganizationId: "org-personal",
          lastOpenedAt: tenMinutesAgo,
        },
      ],
      cloudSession: TEST_CLOUD_SESSION,
      cloudApiBaseUrl: TEST_CLOUD_API_BASE,
      cloudSpaces: [
        { id: "org-personal", name: "My Space", kind: "space", role: "owner", isDefault: true, canCreateProjects: true },
      ],
    });

    await vi.waitFor(() => {
      expect(container.querySelectorAll("[data-agent-place='cloud'] .onboarding-agent.is-face")).toHaveLength(2);
    });

    const cloudFaces = [...container.querySelectorAll<HTMLElement>("[data-agent-place='cloud'] .onboarding-agent.is-face")];
    // Avatar-only in the Cloud group: no visible Agent text labels inside `.is-face`.
    expect(cloudFaces.every((face) => face.querySelector(".onboarding-agent-name") === null)).toBe(true);
    const labels = cloudFaces.map((face) => stripBidiIsolation(face.getAttribute("aria-label") ?? ""));
    expect(labels[0]).toMatch(/^ChatGPT · 2 minutes ago$/);
    expect(labels[1]).toBe("Manus");

    // Cloud project tiles receive their Agent avatars; local project tiles receive none.
    const localTile = [...container.querySelectorAll(".onboarding-project-row-wrap")]
      .find((wrap) => wrap.querySelector(".onboarding-project-tile-name")?.textContent === "Notes");
    const revenueTile = [...container.querySelectorAll(".onboarding-project-row-wrap")]
      .find((wrap) => wrap.querySelector(".onboarding-project-tile-name")?.textContent === "revenue");
    expect(localTile).toBeDefined();
    expect(revenueTile).toBeDefined();
    expect(localTile?.querySelector(".onboarding-project-folder-agents")).toBeNull();
    expect(revenueTile?.querySelectorAll(".onboarding-project-folder-agent")).toHaveLength(2);

    const agentLinkCallsAfterMount = requestCloudSessionApi.mock.calls
      .filter(([req]) => String(req?.path ?? "").includes("/agent-links")).length;
    expect(agentLinkCallsAfterMount).toBe(3);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await vi.waitFor(() => {
      const afterFocus = requestCloudSessionApi.mock.calls
        .filter(([req]) => String(req?.path ?? "").includes("/agent-links")).length;
      expect(afterFocus).toBe(6);
    });
  });
});
