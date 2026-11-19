import type {
  DesktopCloudAutomationOauthStatus,
  DesktopCloudAutomationProviderResources,
  DesktopCloudAutomationProviderSpec,
  DesktopCloudSession,
} from "../cloudApi";

type MutableSessionHandler = (session: DesktopCloudSession | null) => void | Promise<void>;

export type CloudAutomationTransport = <T>(
  path: string,
  session: DesktopCloudSession,
  onSessionChange?: MutableSessionHandler,
  init?: RequestInit,
  apiBaseUrl?: string | null,
) => Promise<T>;

export function createCloudAutomationApi(cloudApiRequest: CloudAutomationTransport) {
  // Automation composes provider discovery and OAuth; resource URLs are canonical.
  const SYNCHRONIZE_BASE = "/synchronize";

  // Connector provider keys are part of the desktop domain model, while the
  // OAuth router has an independently-established slug contract. Keep the
  // translation private to this transport adapter so UI code never guesses it.
  const CLOUD_AUTOMATION_OAUTH_SLUG_BY_PROVIDER: Readonly<Record<string, string>> = Object.freeze({
    airtable: "airtable",
    github: "github",
    gmail: "gmail",
    google_calendar: "google-calendar",
    google_docs: "google-docs",
    google_drive: "google-drive",
    google_search_console: "google-search-console",
    google_sheets: "google-sheets",
    linear: "linear",
    notion: "notion",
  });

  function cloudAutomationWirePath(suffix: string) {
    return `${SYNCHRONIZE_BASE}${suffix}`;
  }

  function cloudAutomationOauthPath(provider: string, suffix: "status" | "authorize") {
    const slug = CLOUD_AUTOMATION_OAUTH_SLUG_BY_PROVIDER[provider.trim().toLowerCase()];
    if (!slug) throw new Error(`OAuth is not available for Automation provider ${provider}.`);
    return `/oauth/${slug}/${suffix}`;
  }

  function supportsCloudAutomationOauth(provider: string) {
    return Boolean(CLOUD_AUTOMATION_OAUTH_SLUG_BY_PROVIDER[provider.trim().toLowerCase()]);
  }

  function getCloudAutomationOauthStatus(
    session: DesktopCloudSession,
    provider: string,
    onSessionChange?: MutableSessionHandler,
    apiBaseUrl?: string | null,
  ): Promise<DesktopCloudAutomationOauthStatus> {
    return cloudApiRequest<DesktopCloudAutomationOauthStatus>(
      cloudAutomationOauthPath(provider, "status"),
      session,
      onSessionChange,
      {},
      apiBaseUrl,
    );
  }

  async function getCloudAutomationOauthAuthorizeUrl(
    session: DesktopCloudSession,
    provider: string,
    onSessionChange?: MutableSessionHandler,
    apiBaseUrl?: string | null,
  ): Promise<string> {
    const response = await cloudApiRequest<{ authorization_url: string }>(
      cloudAutomationOauthPath(provider, "authorize"),
      session,
      onSessionChange,
      {},
      apiBaseUrl,
    );
    const authorizationUrl = response.authorization_url?.trim();
    if (!authorizationUrl) throw new Error("Cloud did not return an authorization URL.");
    return authorizationUrl;
  }

  async function openCloudAutomationAuthorizationUrl(authorizationUrl: string): Promise<void> {
    let url: URL;
    try {
      url = new URL(authorizationUrl);
    } catch {
      throw new Error("Cloud returned an invalid authorization URL.");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error("Cloud returned an unsafe authorization URL.");
    }
    if (window.puppyoneDesktop?.openExternalUrl) {
      await window.puppyoneDesktop.openExternalUrl(url.toString());
      return;
    }
    const opened = window.open(url.toString(), "_blank", "noopener,noreferrer");
    if (!opened) throw new Error("The authorization page could not be opened.");
  }

  function listCloudAutomationProviderResources(
    session: DesktopCloudSession,
    provider: string,
    options: { q?: string; cursor?: string | null; resourceType?: string | null } = {},
    onSessionChange?: MutableSessionHandler,
    apiBaseUrl?: string | null,
  ): Promise<DesktopCloudAutomationProviderResources> {
    const query = new URLSearchParams();
    if (options.q?.trim()) query.set("q", options.q.trim());
    if (options.cursor) query.set("cursor", options.cursor);
    if (options.resourceType) query.set("resource_type", options.resourceType);
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return cloudApiRequest<DesktopCloudAutomationProviderResources>(
      cloudAutomationWirePath(`/providers/${encodeURIComponent(provider)}/resources${suffix}`),
      session,
      onSessionChange,
      {},
      apiBaseUrl,
    );
  }

  function listCloudAutomationProviderSpecs(
    session: DesktopCloudSession,
    onSessionChange?: MutableSessionHandler,
    apiBaseUrl?: string | null,
  ): Promise<DesktopCloudAutomationProviderSpec[]> {
    return cloudApiRequest<DesktopCloudAutomationProviderSpec[]>(
      cloudAutomationWirePath("/providers"),
      session,
      onSessionChange,
      {},
      apiBaseUrl,
    );
  }

  return Object.freeze({
    supportsCloudAutomationOauth,
    getCloudAutomationOauthStatus,
    getCloudAutomationOauthAuthorizeUrl,
    openCloudAutomationAuthorizationUrl,
    listCloudAutomationProviderResources,
    listCloudAutomationProviderSpecs,
  });
}
