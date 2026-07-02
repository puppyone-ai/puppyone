import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Check, CreditCard, ExternalLink, Mail, RefreshCw, X } from "lucide-react";
import {
  getCloudOrganizationEntitlements,
  listCloudOrganizationMembers,
  listCloudOrganizations,
  type DesktopCloudOrgMember,
  type DesktopCloudOrganization,
  type DesktopCloudOrganizationEntitlements,
  type DesktopCloudProject,
  type DesktopCloudSession,
} from "../../../lib/cloudApi";

type CloudGlobalPageProps = {
  accountEmail: string | null;
  session: DesktopCloudSession;
  apiBaseUrl: string | null;
  projects: DesktopCloudProject[];
  onSessionChange: (session: DesktopCloudSession | null) => void;
  onOpen: () => void;
};

type PlanItem = {
  type: "metric" | "capability";
  value?: string;
  label: string;
  included?: boolean;
};

type PlanDefinition = {
  id: "free" | "plus" | "pro" | "enterprise";
  name: string;
  price: string;
  cadence?: string;
  line: string;
  badge?: string;
  items: PlanItem[];
};

const PLANS: PlanDefinition[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    cadence: "/ month",
    line: "Basic access for one project.",
    items: [
      { type: "metric", value: "1", label: "seat" },
      { type: "metric", value: "1", label: "project" },
      { type: "metric", value: "2", label: "scopes/project" },
      { type: "metric", value: "1 GB", label: "storage" },
      { type: "metric", value: "1 GB", label: "storage/project" },
      { type: "metric", value: "2,000", label: "files/project" },
      { type: "metric", value: "50 MB", label: "single file upload" },
      { type: "capability", label: "Git Remote" },
      { type: "capability", label: "CLI" },
      { type: "capability", label: "MCP", included: false },
      { type: "capability", label: "Workspace", included: false },
      { type: "capability", label: "Sandbox", included: false },
      { type: "capability", label: "Enterprise deployment", included: false },
    ],
  },
  {
    id: "plus",
    name: "Plus",
    price: "$15",
    cadence: "/ month",
    line: "For small teams.",
    badge: "Recommended",
    items: [
      { type: "metric", value: "10", label: "seats" },
      { type: "metric", value: "5", label: "projects" },
      { type: "metric", value: "10", label: "scopes/project" },
      { type: "metric", value: "50 GB", label: "storage" },
      { type: "metric", value: "10 GB", label: "storage/project" },
      { type: "metric", value: "25,000", label: "files/project" },
      { type: "metric", value: "200 MB", label: "single file upload" },
      { type: "capability", label: "Git Remote" },
      { type: "capability", label: "CLI" },
      { type: "capability", label: "MCP" },
      { type: "capability", label: "Workspace", included: false },
      { type: "capability", label: "Sandbox", included: false },
      { type: "capability", label: "Enterprise deployment", included: false },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$100",
    cadence: "/ month",
    line: "For larger teams.",
    items: [
      { type: "metric", value: "50", label: "seats" },
      { type: "metric", value: "50", label: "projects" },
      { type: "metric", value: "Unlimited", label: "scopes" },
      { type: "metric", value: "500 GB", label: "storage" },
      { type: "metric", value: "50 GB", label: "storage/project" },
      { type: "metric", value: "250,000", label: "files/project" },
      { type: "metric", value: "500 MB", label: "single file upload" },
      { type: "capability", label: "Git Remote" },
      { type: "capability", label: "CLI" },
      { type: "capability", label: "MCP" },
      { type: "capability", label: "Workspace" },
      { type: "capability", label: "Sandbox" },
      { type: "capability", label: "Enterprise deployment", included: false },
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Custom",
    line: "For private deployments.",
    items: [
      { type: "metric", value: "Custom", label: "seats" },
      { type: "metric", value: "Custom", label: "projects" },
      { type: "metric", value: "Custom", label: "scopes" },
      { type: "metric", value: "Custom", label: "storage" },
      { type: "metric", value: "Custom", label: "storage/project" },
      { type: "metric", value: "Custom", label: "files/project" },
      { type: "metric", value: "Custom", label: "single file upload" },
      { type: "capability", label: "Git Remote" },
      { type: "capability", label: "CLI" },
      { type: "capability", label: "MCP" },
      { type: "capability", label: "Workspace" },
      { type: "capability", label: "Sandbox" },
      { type: "capability", label: "Enterprise deployment" },
    ],
  },
];

const UPGRADE_PLANS = PLANS.filter((plan) => plan.id !== "free");
const CURRENT_SUMMARY_LABELS = new Set([
  "seat",
  "seats",
  "project",
  "projects",
  "scopes/project",
  "scopes",
  "storage",
  "storage/project",
  "single file upload",
  "Git Remote",
  "CLI",
  "MCP",
  "Workspace",
  "Sandbox",
]);
const UPGRADE_DETAIL_LABELS = new Set([
  "seats",
  "projects",
  "scopes/project",
  "scopes",
  "storage",
  "storage/project",
  "files/project",
  "single file upload",
  "MCP",
  "Workspace",
  "Sandbox",
  "Enterprise deployment",
]);

export function CloudGlobalTeamPage({ accountEmail, session, apiBaseUrl, projects, onSessionChange, onOpen }: CloudGlobalPageProps) {
  const orgData = useCloudOrganizationData(session, apiBaseUrl, onSessionChange);
  const organization = orgData.organization;
  const members = orgData.members.length > 0 ? orgData.members : buildFallbackMembers(accountEmail);
  const displayName = accountEmail?.split("@")[0] || "Cloud user";
  const seatLimit = organization?.seat_limit ?? Math.max(1, members.length);
  const plan = organization?.plan ?? "free";

  return (
    <CloudOrganizationPageShell
      title="Team"
      description={`Manage members and their access to ${organization?.name ?? "your Cloud organization"}.`}
      actions={(
        <button className="desktop-cloud-org-primary-button" type="button" onClick={onOpen}>
          <Mail size={14} />
          <span>Invite Member</span>
        </button>
      )}
    >
      <div className="desktop-cloud-org-card">
        <div className="desktop-cloud-org-card-header">
          <div>
            <h2>Members</h2>
            <p>{members.length} / {seatLimit} seats used in your {plan} plan.</p>
          </div>
        </div>

        <div className="desktop-cloud-team-list">
          {members.map((member, index) => {
            const name = member.display_name || member.email || displayName;
            const initial = (name[0] || "U").toUpperCase();
            return (
              <div className="desktop-cloud-team-row" key={member.id || member.user_id || member.email || index}>
                <div className="desktop-cloud-team-member">
                  {member.avatar_url ? (
                    <img src={member.avatar_url} alt="" className="desktop-cloud-team-avatar image" />
                  ) : (
                    <span className="desktop-cloud-team-avatar" aria-hidden="true">{initial}</span>
                  )}
                  <div>
                    <strong>
                      <span>{name}</span>
                      {member.role === "owner" && <em>Owner</em>}
                    </strong>
                    {member.email && member.display_name && <small>{member.email}</small>}
                  </div>
                </div>
                <span className={`desktop-cloud-team-role ${member.role === "owner" ? "owner" : ""}`}>
                  {formatRole(member.role)}
                </span>
              </div>
            );
          })}
        </div>

        {orgData.loading && members.length === 0 && (
          <div className="desktop-cloud-team-loading">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index}>
                <span />
                <div>
                  <i />
                  <i />
                </div>
              </div>
            ))}
          </div>
        )}

        {orgData.error && (
          <div className="desktop-cloud-org-inline-error">
            <strong>Could not load team details</strong>
            <span>{orgData.error}</span>
          </div>
        )}

        <div className="desktop-cloud-org-card-footer">
          <span>{projects.length} Cloud project{projects.length === 1 ? "" : "s"} in this desktop session.</span>
          <button type="button" onClick={onOpen}>Open full team page</button>
        </div>
      </div>
    </CloudOrganizationPageShell>
  );
}

export function CloudGlobalBillingPage({ session, apiBaseUrl, projects, onSessionChange, onOpen }: CloudGlobalPageProps) {
  const orgData = useCloudOrganizationData(session, apiBaseUrl, onSessionChange);
  const organization = orgData.organization;
  const currentDisplayPlan = normalizeDisplayPlanId(orgData.entitlements?.plan_id || organization?.plan);
  const currentPlan = getPlanById(currentDisplayPlan);
  const currentSummaryItems = currentPlan.items.filter((item) => CURRENT_SUMMARY_LABELS.has(item.label));

  return (
    <CloudOrganizationPageShell
      title="Billing"
      description={`Manage the plan for ${organization?.name ?? "your Cloud organization"}.`}
      actions={(
        <button className="desktop-cloud-org-secondary-button" type="button" onClick={onOpen}>
          <RefreshCw size={14} />
          <span>Refresh</span>
        </button>
      )}
    >
      <div className="desktop-cloud-billing-stack">
        {orgData.error && (
          <div className="desktop-cloud-org-inline-error standalone">
            <strong>Could not load billing details</strong>
            <span>{orgData.error}</span>
          </div>
        )}

        <section className="desktop-cloud-billing-current">
          <div className="desktop-cloud-billing-current-main">
            <div>
              <div className="desktop-cloud-billing-title-row">
                <span>Current plan</span>
                <h2>{currentPlan.name}</h2>
                {orgData.loading && <em>Syncing</em>}
              </div>
              <p>{currentPlan.line}</p>
            </div>
            <div className="desktop-cloud-billing-price">
              <strong>{currentPlan.price}</strong>
              <span>{currentPlan.cadence}</span>
              <small>Managed through Polar</small>
            </div>
          </div>
          <div className="desktop-cloud-billing-summary">
            {currentSummaryItems.map((item) => (
              <PlanFeature key={`current-${item.value || "included"}-${item.label}`} item={item} />
            ))}
          </div>
        </section>

        <section className="desktop-cloud-billing-options">
          <div className="desktop-cloud-billing-options-header">
            <div>
              <h2>Upgrade options</h2>
              <p>Pick Plus for MCP, Pro for hosted workspace, or Enterprise for private deployment.</p>
            </div>
            <span>Checkout through Polar</span>
          </div>
          <div className="desktop-cloud-billing-plan-grid">
            {UPGRADE_PLANS.map((plan) => (
              <PlanCard key={plan.id} plan={plan} current={plan.id === currentDisplayPlan} onOpen={onOpen} />
            ))}
          </div>
        </section>

        <div className="desktop-cloud-billing-note">
          <span>Checkout is handled by Polar. {projects.length} project{projects.length === 1 ? "" : "s"} in this desktop session.</span>
          <span>Secure billing <ExternalLink size={12} /></span>
        </div>
      </div>
    </CloudOrganizationPageShell>
  );
}

function CloudOrganizationPageShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="desktop-cloud-org-page">
      <div className="desktop-cloud-org-shell">
        <div className="desktop-cloud-org-header">
          <div>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          {actions && <div>{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

function PlanCard({ plan, current, onOpen }: { plan: PlanDefinition; current: boolean; onOpen: () => void }) {
  const detailItems = plan.items.filter((item) => UPGRADE_DETAIL_LABELS.has(item.label));
  const isRecommended = Boolean(plan.badge && !current);
  return (
    <article className={`desktop-cloud-billing-plan-card ${plan.id === "plus" ? "recommended" : ""}`}>
      <div>
        <div className="desktop-cloud-billing-plan-heading">
          <h3>{plan.name}</h3>
          {current && <span>Current</span>}
          {isRecommended && <span>{plan.badge}</span>}
        </div>
        <p>{plan.line}</p>
      </div>

      <div className="desktop-cloud-billing-plan-price">
        <strong>{plan.price}</strong>
        {plan.cadence && <span>{plan.cadence}</span>}
      </div>

      <div className="desktop-cloud-billing-plan-features">
        {detailItems.map((item) => (
          <PlanFeature key={`${plan.id}-${item.value || "included"}-${item.label}`} item={item} />
        ))}
      </div>

      <button className={plan.id === "plus" ? "primary" : ""} type="button" onClick={onOpen}>
        {plan.id === "enterprise" ? <Mail size={14} /> : <CreditCard size={14} />}
        <span>{current ? "Current plan" : plan.id === "enterprise" ? "Contact us" : `Choose ${plan.name}`}</span>
        {plan.id !== "enterprise" && <ExternalLink size={13} />}
      </button>
    </article>
  );
}

function useCloudOrganizationData(
  session: DesktopCloudSession,
  apiBaseUrl: string | null,
  onSessionChange: (session: DesktopCloudSession | null) => void,
) {
  const [state, setState] = useState<{
    organization: DesktopCloudOrganization | null;
    members: DesktopCloudOrgMember[];
    entitlements: DesktopCloudOrganizationEntitlements | null;
    loading: boolean;
    error: string | null;
  }>({
    organization: null,
    members: [],
    entitlements: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setState((current) => ({ ...current, loading: true, error: null }));
      try {
        const organizations = await listCloudOrganizations(session, onSessionChange, apiBaseUrl);
        const organization = organizations[0] ?? null;
        if (!organization) {
          if (!cancelled) {
            setState({ organization: null, members: [], entitlements: null, loading: false, error: null });
          }
          return;
        }

        const [membersResult, entitlementResult] = await Promise.allSettled([
          listCloudOrganizationMembers(session, organization.id, onSessionChange, apiBaseUrl),
          getCloudOrganizationEntitlements(session, organization.id, onSessionChange, apiBaseUrl),
        ]);
        if (cancelled) return;
        setState({
          organization,
          members: membersResult.status === "fulfilled" ? membersResult.value : [],
          entitlements: entitlementResult.status === "fulfilled" ? entitlementResult.value : null,
          loading: false,
          error: membersResult.status === "rejected" || entitlementResult.status === "rejected"
            ? "Some organization details could not be loaded."
            : null,
        });
      } catch (error) {
        if (!cancelled) {
          setState({
            organization: null,
            members: [],
            entitlements: null,
            loading: false,
            error: error instanceof Error ? error.message : "Unable to load organization details.",
          });
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, onSessionChange, session]);

  return state;
}

function buildFallbackMembers(accountEmail: string | null): DesktopCloudOrgMember[] {
  if (!accountEmail) return [];
  return [{
    id: "current-user",
    user_id: "current-user",
    email: accountEmail,
    display_name: accountEmail.split("@")[0],
    avatar_url: null,
    role: "owner",
    joined_at: "",
  }];
}

function normalizeDisplayPlanId(value: unknown): PlanDefinition["id"] {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "plus" || raw === "pro" || raw === "enterprise") return raw;
  return "free";
}

function getPlanById(id: PlanDefinition["id"]): PlanDefinition {
  return PLANS.find((plan) => plan.id === id) ?? PLANS[0];
}

function formatRole(role: string) {
  if (role === "owner") return "Owner";
  if (role === "member") return "Member";
  if (role === "viewer") return "Viewer";
  return role;
}

function PlanFeature({ item }: { item: PlanItem }) {
  const included = item.included !== false;
  return (
    <span className={`desktop-cloud-plan-feature ${included ? "" : "disabled"}`}>
      {included ? <Check size={14} /> : <X size={14} />}
      <span>
        {item.value && <strong>{item.value}</strong>}
        <span className={item.value ? "with-value" : ""}>{item.label}</span>
      </span>
    </span>
  );
}
