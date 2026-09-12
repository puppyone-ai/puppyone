/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CloudServiceSidebar } from "../src/features/cloud/CloudServiceSidebar";
import { CloudSignedOutRoute } from "../src/features/cloud/auth/CloudSignedOutRoute";
import type { CloudAuthState } from "../src/features/cloud/auth";
import { FeatureFlagsProvider } from "../src/features/flags";
import type { DesktopCloudSession } from "../src/lib/cloudApi";
import { renderWithTestLocalization } from "./testLocalization";

const session: DesktopCloudSession = {
  expires_in: 3600,
  expires_at: Date.now() + 3600_000,
  user_id: "user-1",
  user_email: "owner@example.com",
  api_base_url: "https://cloud.example.com",
  session_generation: "generation-1",
  status: "authenticated",
};

describe("current-repository Cloud navigation", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("keeps one stable sidebar while signed out, uninitialized, and linked", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onSelectSection = vi.fn();

    renderSidebar(root, {
      authState: { status: "signed-out", apiBaseUrl: session.api_base_url },
      activeSection: "initialize",
      projectAvailable: false,
      onSelectSection,
    });
    expect(labels(container)).toEqual([
      "Homepage", "Serve via MCP", "Access via CLI", "Team", "Billing",
    ]);
    expect(groupLabels(container)).toEqual(["Cloud Project", "External access", "Organization"]);
    expect(labels(container)).not.toContain("Settings");
    expect(rows(container).every((row) => row.getAttribute("aria-disabled") !== "true")).toBe(true);
    expect(rows(container)[1]?.getAttribute("aria-current")).toBe("page");
    act(() => rows(container)[1]?.click());
    expect(onSelectSection).toHaveBeenCalledWith("mcp");
    act(() => rows(container)[2]?.click());
    expect(onSelectSection).toHaveBeenCalledWith("cli");

    renderSidebar(root, {
      authState: signedInState(),
      projectAvailable: false,
      onSelectSection,
    });
    expect(labels(container)).toEqual([
      "Homepage", "Serve via MCP", "Access via CLI", "Team", "Billing",
    ]);
    expect(labels(container)).not.toContain("Settings");
    expect(rows(container).every((row) => row.getAttribute("aria-disabled") !== "true")).toBe(true);
    act(() => rows(container)[1]?.click());
    expect(onSelectSection).toHaveBeenCalledWith("mcp");

    renderSidebar(root, {
      authState: signedInState(),
      projectAvailable: true,
      onSelectSection,
    });
    expect(rows(container).every((row) => row.getAttribute("aria-disabled") !== "true")).toBe(true);

    renderSidebar(root, {
      authState: signedInState(),
      projectAvailable: true,
      projectCapabilities: ["project.settings.manage"],
      onSelectSection,
    });
    expect(rows(container).every((row) => row.getAttribute("aria-disabled") !== "true")).toBe(true);

    renderSidebar(root, {
      authState: signedInState(),
      activeSection: "history",
      projectAvailable: true,
      projectCapabilities: ["project.settings.manage"],
      onSelectSection,
    });
    expect(rows(container)[0]?.getAttribute("aria-current")).toBe("page");
    expect(labels(container)).not.toContain("History");

    renderSidebar(root, {
      authState: signedInState(),
      activeSection: "settings",
      projectAvailable: true,
      projectCapabilities: ["project.settings.manage"],
      onSelectSection,
    });
    expect(rows(container)[0]?.getAttribute("aria-current")).toBe("page");
    expect(labels(container)).not.toContain("Settings");
  });

  it("shows Automation only after the experiment is enabled", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    renderSidebar(root, {
      authState: signedInState(),
      automationEnabled: true,
      projectAvailable: true,
      onSelectSection: vi.fn(),
    });

    expect(labels(container)).toContain("Automation");
    expect(groupLabels(container)).toContain("Automation");
  });

  it("keeps the signed-out Cloud entry focused on one activation action", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => renderWithTestLocalization(root,
      <CloudSignedOutRoute
        activeSection="mcp"
        authState={{ status: "signed-out", apiBaseUrl: session.api_base_url }}
        apiBaseUrl={session.api_base_url}
        loadingLabel="Restoring Cloud session…"
        onSessionChange={vi.fn()}
        onRefresh={vi.fn()}
      />,
    ));

    expect(container.querySelector("h1")?.textContent).toBe("Serve this project via MCP");
    expect(container.querySelector(".desktop-entry-state-description")?.textContent)
      .toBe("Let ChatGPT, Claude, and other external agents access this Cloud Project through its hosted MCP server.");
    expect(container.querySelector(".desktop-cloud-auth-submit")?.textContent)
      .toBe("Get Started");
    expect(container.textContent).not.toContain("May upload");
    expect(container.querySelector(".desktop-cloud-mcp-illustration")).not.toBeNull();

    act(() => renderWithTestLocalization(root,
      <CloudSignedOutRoute
        activeSection="cli"
        authState={{ status: "signed-out", apiBaseUrl: session.api_base_url }}
        apiBaseUrl={session.api_base_url}
        loadingLabel="Restoring Cloud session…"
        onSessionChange={vi.fn()}
        onRefresh={vi.fn()}
      />,
    ));
    expect(container.querySelector("h1")?.textContent).toBe("Access this project from the CLI");
    expect(container.querySelector(".desktop-cloud-channel-illustration.is-cli")).not.toBeNull();

    act(() => renderWithTestLocalization(root,
      <CloudSignedOutRoute
        activeSection="git-sync"
        authState={{ status: "signed-out", apiBaseUrl: session.api_base_url }}
        apiBaseUrl={session.api_base_url}
        loadingLabel="Restoring Cloud session…"
        onSessionChange={vi.fn()}
        onRefresh={vi.fn()}
      />,
    ));
    expect(container.querySelector("h1")?.textContent).toBe("Git");
    expect(container.querySelector(".desktop-cloud-channel-illustration.is-git")).not.toBeNull();

    act(() => renderWithTestLocalization(root,
      <CloudSignedOutRoute
        activeSection="automation"
        authState={{ status: "signed-out", apiBaseUrl: session.api_base_url }}
        apiBaseUrl={session.api_base_url}
        loadingLabel="Restoring Cloud session…"
        onSessionChange={vi.fn()}
        onRefresh={vi.fn()}
      />,
    ));
    expect(container.querySelector("h1")?.textContent).toBe("Automation");
    expect(container.querySelector(".desktop-cloud-activation-illustration.is-automation")).not.toBeNull();

    act(() => renderWithTestLocalization(root,
      <CloudSignedOutRoute
        activeSection="contents"
        authState={{ status: "signed-out", apiBaseUrl: session.api_base_url }}
        apiBaseUrl={session.api_base_url}
        loadingLabel="Restoring Cloud session…"
        onSessionChange={vi.fn()}
        onRefresh={vi.fn()}
      />,
    ));
    expect(container.querySelector("h1")?.textContent).toBe("PuppyOne Cloud");
    expect(container.querySelector(".desktop-cloud-activation-illustration.is-overview")).not.toBeNull();
    expect(container.querySelector(".desktop-cloud-overview-hosting-art")).not.toBeNull();
    expect(container.querySelector(".desktop-cloud-overview-hosting-cloud")).not.toBeNull();
    expect(container.querySelector(".desktop-cloud-overview-hosting-folder-mark")).not.toBeNull();
    expect(container.querySelector(".desktop-cloud-overview-hosting-folder-logo")).not.toBeNull();
    expect(container.querySelector(".desktop-cloud-overview-hosting-status")).not.toBeNull();

    act(() => renderWithTestLocalization(root,
      <CloudSignedOutRoute
        activeSection="access"
        authState={{ status: "signed-out", apiBaseUrl: session.api_base_url }}
        apiBaseUrl={session.api_base_url}
        loadingLabel="Restoring Cloud session…"
        onSessionChange={vi.fn()}
        onRefresh={vi.fn()}
      />,
    ));
    expect(container.querySelector("h1")?.textContent).toBe("Permissions");
    expect(container.querySelector(".desktop-cloud-activation-illustration.is-access")).not.toBeNull();
  });
});

function renderSidebar(root: Root, {
  authState,
  activeSection = "contents",
  automationEnabled = false,
  projectAvailable,
  projectCapabilities = [],
  onSelectSection,
}: {
  authState: CloudAuthState;
  activeSection?: Parameters<typeof CloudServiceSidebar>[0]["activeSection"];
  automationEnabled?: boolean;
  projectAvailable: boolean;
  projectCapabilities?: string[];
  onSelectSection: (section: Parameters<typeof CloudServiceSidebar>[0]["activeSection"]) => void;
}) {
  act(() => renderWithTestLocalization(root,
    <FeatureFlagsProvider value={{
      cloudWorkspace: true,
      cloudBilling: true,
      assetLibraryHome: false,
    }}>
      <CloudServiceSidebar
        cloudAuthState={authState}
        activeSection={activeSection}
        automationEnabled={automationEnabled}
        projectAvailable={projectAvailable}
        projectCapabilities={projectCapabilities}
        onSelectSection={onSelectSection}
      />
    </FeatureFlagsProvider>,
  ));
}

function signedInState(): CloudAuthState {
  return { status: "signed-in", apiBaseUrl: session.api_base_url, session };
}

function rows(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(".po-sidebar-row"));
}

function labels(container: HTMLElement) {
  return rows(container).map((row) => row.textContent?.trim());
}

function groupLabels(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(".po-desktop-sidebar-group__title"))
    .map((group) => group.textContent?.trim());
}
