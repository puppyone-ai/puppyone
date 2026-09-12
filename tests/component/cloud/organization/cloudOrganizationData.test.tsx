/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";

const api = vi.hoisted(() => ({
  listCloudOrganizations: vi.fn(),
  listCloudOrganizationMembers: vi.fn(),
  getCloudOrganizationEntitlements: vi.fn(),
  getCloudOrganizationSeatUsage: vi.fn(),
}));

vi.mock("../../../../src/lib/cloudApi", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/lib/cloudApi")>("../../../../src/lib/cloudApi");
  return { ...actual, ...api };
});

import { useCloudOrganizationData } from "../../../../src/features/cloud/organization/CloudOrganizationTeamPage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const baseSession = {
  user_id: "user-a",
  user_email: "a@example.com",
  api_base_url: "https://cloud.example/api/v1",
  session_generation: "generation-a",
  expires_in: 3600,
  expires_at: 0,
  status: "authenticated",
} satisfies DesktopCloudSession;

const organizations = [
  {
    id: "org-a",
    name: "Organization A",
    slug: "organization-a",
    plan: "plus",
    seat_limit: 5,
    created_at: "2026-07-15T00:00:00Z",
  },
  {
    id: "org-b",
    name: "Organization B",
    slug: "organization-b",
    plan: "business",
    seat_limit: 20,
    created_at: "2026-07-15T00:00:00Z",
  },
];

function members(orgId: string) {
  return [{
    id: `member-${orgId}`,
    user_id: baseSession.user_id,
    email: baseSession.user_email,
    display_name: "Owner",
    role: "owner",
    joined_at: "2026-07-15T00:00:00Z",
  }];
}

function entitlements(orgId: string) {
  return {
    org_id: orgId,
    plan_id: "plus",
    status: "active",
    source: "puppypay",
    seat_quantity: 2,
    catalog_version: "2026-07-15.1",
    source_revision: 2,
    entitlements: {},
  };
}

function Probe({
  session = baseSession,
  selectionPolicy = "remembered",
}: {
  session?: DesktopCloudSession;
  selectionPolicy?: "remembered" | "explicit";
}) {
  const organization = useCloudOrganizationData(
    session,
    session.api_base_url,
    React.useCallback(() => undefined, []),
    { selectionPolicy },
  );
  return (
    <div
      data-status={organization.status}
      data-members-status={organization.membersStatus}
      data-organization={organization.organization?.id ?? ""}
      data-count={organization.organizations.length}
      data-error={organization.error?.code ?? ""}
    >
      <button type="button" onClick={() => organization.selectOrganization("org-b")}>select-b</button>
    </div>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

let root: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  window.localStorage.clear();
  api.listCloudOrganizations.mockResolvedValue([organizations[0]]);
  api.listCloudOrganizationMembers.mockImplementation(async (_session, orgId: string) => members(orgId));
  api.getCloudOrganizationEntitlements.mockImplementation(async (_session, orgId: string) => entitlements(orgId));
  api.getCloudOrganizationSeatUsage.mockResolvedValue({ billable_seat_quantity: 1 });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("useCloudOrganizationData", () => {
  it("ignores remembered ownership when a create flow requires an explicit organization", async () => {
    api.listCloudOrganizations.mockResolvedValueOnce(organizations);
    await act(async () => root?.render(<Probe />));
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-status"))
      .toBe("selection-required"));
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-organization"))
      .toBe("org-b"));

    act(() => root?.unmount());
    api.listCloudOrganizations.mockResolvedValueOnce(organizations);
    root = createRoot(container);
    await act(async () => root?.render(<Probe selectionPolicy="explicit" />));
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-status"))
      .toBe("selection-required"));

    expect(container.firstElementChild?.getAttribute("data-organization")).toBe("");
  });

  it("requires an explicit choice for multiple organizations and loads only the selected one", async () => {
    api.listCloudOrganizations.mockResolvedValueOnce(organizations);

    await act(async () => root?.render(<Probe session={{
      ...baseSession,
      session_generation: "generation-after-restart",
    }} />));
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-status"))
      .toBe("selection-required"));

    expect(container.firstElementChild?.getAttribute("data-count")).toBe("2");
    expect(container.firstElementChild?.getAttribute("data-organization")).toBe("");
    expect(api.listCloudOrganizationMembers).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-status"))
      .toBe("ready"));

    expect(container.firstElementChild?.getAttribute("data-organization")).toBe("org-b");
    expect(api.listCloudOrganizationMembers).toHaveBeenCalledTimes(1);
    expect(api.listCloudOrganizationMembers.mock.calls[0]?.[1]).toBe("org-b");

    act(() => root?.unmount());
    api.listCloudOrganizations.mockResolvedValueOnce(organizations);
    root = createRoot(container);
    await act(async () => root?.render(<Probe />));
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-organization"))
      .toBe("org-b"));
    expect(container.firstElementChild?.getAttribute("data-status")).toBe("ready");
  });

  it("does not reuse an organization preference on another Cloud host", async () => {
    api.listCloudOrganizations.mockResolvedValueOnce(organizations);
    await act(async () => root?.render(<Probe />));
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-status"))
      .toBe("selection-required"));
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-organization"))
      .toBe("org-b"));

    act(() => root?.unmount());
    api.listCloudOrganizations.mockResolvedValueOnce(organizations);
    root = createRoot(container);
    await act(async () => root?.render(<Probe session={{
      ...baseSession,
      api_base_url: "https://other-cloud.example/api/v1",
      session_generation: "generation-other-host",
    }} />));
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-status"))
      .toBe("selection-required"));
    expect(container.firstElementChild?.getAttribute("data-organization")).toBe("");
  });

  it("keeps a member read failure distinct from a successful non-owner result", async () => {
    api.listCloudOrganizationMembers.mockRejectedValueOnce(new Error("members unavailable"));

    await act(async () => root?.render(<Probe />));
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-status"))
      .toBe("partial"));

    expect(container.firstElementChild?.getAttribute("data-members-status")).toBe("error");
    expect(container.firstElementChild?.getAttribute("data-error")).toBe("organization-partial");
  });

  it("drops an old account response that completes after the active account", async () => {
    const oldOrganizations = deferred<typeof organizations>();
    api.listCloudOrganizations
      .mockReturnValueOnce(oldOrganizations.promise)
      .mockResolvedValueOnce([{ ...organizations[1], id: "org-new", name: "New account org" }]);
    const nextSession = {
      ...baseSession,
      user_id: "user-b",
      user_email: "b@example.com",
      session_generation: "generation-b",
    };

    await act(async () => root?.render(<Probe />));
    await act(async () => root?.render(<Probe session={nextSession} />));
    await vi.waitFor(() => expect(container.firstElementChild?.getAttribute("data-organization"))
      .toBe("org-new"));

    await act(async () => oldOrganizations.resolve(organizations));
    expect(container.firstElementChild?.getAttribute("data-organization")).toBe("org-new");
  });
});
