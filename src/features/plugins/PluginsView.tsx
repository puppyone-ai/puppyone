import { Tooltip } from "@puppyone/shared-ui";
import { useMemo, useState } from "react";
import {
  Box,
  FileArchive,
  FileText,
  Film,
  Image,
  MoreHorizontal,
  PackagePlus,
  Presentation,
  Search,
  Table2,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type { ViewerContribution, ViewerPackSnapshot } from "@puppyone/shared-ui";
import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import {
  OFFICIAL_VIEWER_CATALOG,
  type OfficialViewerCatalogEntry,
  type OfficialViewerIcon,
} from "./pluginCatalog";
import type { PluginsSection } from "./PluginsSidebar";

type PluginBridge = NonNullable<NonNullable<typeof window.puppyoneDesktop>["viewerPacks"]>;

type PluginFeedback = Readonly<
  | { tone: "success"; code: "installed"; pluginId: string; version: string }
  | { tone: "success"; code: "removed"; label: string }
  | { tone: "danger"; code: "remove-rejected" }
  | { tone: "danger"; code: "operation-failed"; detail: string }
>;

export function PluginsView({
  activeSection,
  hostAvailable,
  snapshot,
  onRefresh,
  onSelectSection,
}: {
  activeSection: PluginsSection;
  hostAvailable: boolean;
  snapshot: ViewerPackSnapshot;
  onRefresh: () => void | Promise<void>;
  onSelectSection: (section: PluginsSection) => void;
}) {
  const { getCollator, t } = useLocalization();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<PluginFeedback | null>(null);
  const [query, setQuery] = useState("");
  const labelCollator = useMemo(() => getCollator({ sensitivity: "base" }), [getCollator]);
  const installed = useMemo(
    () => [...snapshot.contributions].sort((a, b) => labelCollator.compare(a.label, b.label)),
    [labelCollator, snapshot.contributions],
  );

  const installLocal = async () => {
    const bridge = getPluginBridge();
    if (!bridge) return;
    setBusyAction("install");
    setFeedback(null);
    try {
      const result = await bridge.installLocal();
      if (result.canceled) return;
      await onRefresh();
      setFeedback({
        tone: "success",
        code: "installed",
        pluginId: result.pluginId,
        version: result.version,
      });
    } catch (error) {
      setFeedback({
        tone: "danger",
        code: "operation-failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const uninstall = async (plugin: ViewerContribution) => {
    const bridge = getPluginBridge();
    if (!bridge) return;
    setBusyAction(`remove:${plugin.pluginId}`);
    setFeedback(null);
    try {
      const result = await bridge.uninstall({ pluginId: plugin.pluginId });
      if (!result.ok && !result.canceled) {
        setFeedback({ tone: "danger", code: "remove-rejected" });
        return;
      }
      if (result.canceled) return;
      await onRefresh();
      setFeedback({ tone: "success", code: "removed", label: plugin.label });
    } catch (error) {
      setFeedback({
        tone: "danger",
        code: "operation-failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const sectionTitle = t(`plugins.section.${activeSection}`);
  const feedbackMessage = formatPluginFeedback(feedback, t);

  return (
    <section className="desktop-plugins-view">
      <div className="desktop-plugins-scroll" data-po-scrollbar="content">
        <div className="desktop-plugins-page">
          <header className="desktop-plugins-header">
            <div className="desktop-plugins-title-row">
              <h1>{sectionTitle}</h1>
            </div>
            {activeSection === "installed" && hostAvailable && installed.length > 0 && (
              <button
                className="desktop-plugins-install-action"
                type="button"
                disabled={busyAction !== null}
                onClick={() => void installLocal()}
              >
                <PackagePlus size={14} aria-hidden="true" />
                <span>{busyAction === "install" ? t("plugins.installing") : t("plugins.installFromFile")}</span>
              </button>
            )}
          </header>

          {feedback && feedbackMessage && (
            <div className={`desktop-plugins-feedback ${feedback.tone}`} role={feedback.tone === "danger" ? "alert" : "status"}>
              {feedbackMessage}
            </div>
          )}

          {activeSection === "installed" && (
            <InstalledPlugins
              hostAvailable={hostAvailable}
              installed={installed}
              busyAction={busyAction}
              onBrowse={() => onSelectSection("discover")}
              onInstall={installLocal}
              onUninstall={uninstall}
            />
          )}

          {activeSection === "discover" && (
            <DiscoverPlugins query={query} onQueryChange={setQuery} />
          )}

          {activeSection === "included" && (
            <OfficialPluginList entries={OFFICIAL_VIEWER_CATALOG} showStatus={false} />
          )}
        </div>
      </div>
    </section>
  );
}

function DiscoverPlugins({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const { locale, t } = useLocalization();
  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  const entries = normalizedQuery
    ? OFFICIAL_VIEWER_CATALOG.filter((entry) => (
        `${getOfficialViewerTitle(entry, t)} ${entry.formats.join(" ")}`
          .toLocaleLowerCase(locale)
          .includes(normalizedQuery)
      ))
    : OFFICIAL_VIEWER_CATALOG;

  return (
    <>
      <label className="desktop-plugins-search">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder={t("plugins.search")}
          aria-label={t("plugins.search")}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
      <div className="desktop-plugins-list-heading">
        <span>{t("plugins.official")}</span>
      </div>
      {entries.length > 0 ? (
        <OfficialPluginList entries={entries} showStatus />
      ) : (
        <div className="desktop-plugins-no-results">{t("plugins.noMatches")}</div>
      )}
    </>
  );
}

function OfficialPluginList({
  entries,
  showStatus = false,
}: {
  entries: readonly OfficialViewerCatalogEntry[];
  showStatus?: boolean;
}) {
  return (
    <div className="desktop-official-plugins-list">
      {entries.map((entry) => (
        <OfficialPluginRow key={entry.id} entry={entry} showStatus={showStatus} />
      ))}
    </div>
  );
}

function OfficialPluginRow({
  entry,
  showStatus,
}: {
  entry: OfficialViewerCatalogEntry;
  showStatus: boolean;
}) {
  const { t } = useLocalization();
  const Icon = OFFICIAL_VIEWER_ICONS[entry.icon];
  return (
    <article className="desktop-official-plugin-row">
      <span className="desktop-plugin-mark"><Icon size={19} strokeWidth={1.75} aria-hidden="true" /></span>
      <div>
        <strong>{getOfficialViewerTitle(entry, t)}</strong>
        <span>{entry.formats.join(" · ")}</span>
      </div>
      {showStatus && <small>{t("plugins.includedStatus")}</small>}
    </article>
  );
}

function InstalledPlugins({
  hostAvailable,
  installed,
  busyAction,
  onBrowse,
  onInstall,
  onUninstall,
}: {
  hostAvailable: boolean;
  installed: readonly ViewerContribution[];
  busyAction: string | null;
  onBrowse: () => void;
  onInstall: () => Promise<void>;
  onUninstall: (plugin: ViewerContribution) => Promise<void>;
}) {
  const { t } = useLocalization();
  if (installed.length === 0) {
    return (
      <div className="desktop-plugins-empty">
        <span className="desktop-plugin-mark"><Box size={19} strokeWidth={1.75} aria-hidden="true" /></span>
        <strong>{t("plugins.noneInstalled")}</strong>
        <button
          className="desktop-plugins-empty-action"
          type="button"
          disabled={busyAction !== null}
          onClick={() => hostAvailable ? void onInstall() : onBrowse()}
        >
          {hostAvailable
            ? (busyAction === "install" ? t("plugins.installing") : t("plugins.installFromFile"))
            : t("plugins.browse")}
        </button>
      </div>
    );
  }

  return (
    <div className="desktop-installed-plugins-list">
      {installed.map((plugin) => (
        <InstalledPluginRow
          key={`${plugin.pluginId}:${plugin.contentHash}`}
          plugin={plugin}
          busy={busyAction === `remove:${plugin.pluginId}`}
          onUninstall={onUninstall}
        />
      ))}
    </div>
  );
}

function InstalledPluginRow({
  plugin,
  busy,
  onUninstall,
}: {
  plugin: ViewerContribution;
  busy: boolean;
  onUninstall: (plugin: ViewerContribution) => Promise<void>;
}) {
  const { t } = useLocalization();
  const formats = plugin.formats.flatMap((format) => format.extensions).slice(0, 6);
  return (
    <article className="desktop-installed-plugin-row">
      <span className="desktop-plugin-mark"><Box size={19} strokeWidth={1.75} aria-hidden="true" /></span>
      <div className="desktop-installed-plugin-copy">
        <strong>{plugin.label}</strong>
        <span>{plugin.publisher} · {plugin.version}</span>
        {formats.length > 0 && (
          <small>{formats.map((format) => format.replace(/^\./, "").toUpperCase()).join(" · ")}</small>
        )}
      </div>
      <details className="desktop-plugin-menu">
        <Tooltip content={t("plugins.manage", { name: bidiIsolate(plugin.label) })}><summary
          aria-label={t("plugins.manage", { name: bidiIsolate(plugin.label) })}
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </summary></Tooltip>
        <div>
          <button type="button" disabled={busy} onClick={() => void onUninstall(plugin)}>
            <Trash2 size={13} aria-hidden="true" />
            <span>{busy ? t("plugins.removing") : t("plugins.remove")}</span>
          </button>
        </div>
      </details>
    </article>
  );
}

function getPluginBridge(): PluginBridge | null {
  return typeof window !== "undefined" ? window.puppyoneDesktop?.viewerPacks ?? null : null;
}

function getOfficialViewerTitle(
  entry: OfficialViewerCatalogEntry,
  t: ReturnType<typeof useLocalization>["t"],
): string {
  return t(`plugins.catalog.${entry.id}`);
}

function formatPluginFeedback(
  feedback: PluginFeedback | null,
  t: ReturnType<typeof useLocalization>["t"],
): string | null {
  if (!feedback) return null;
  if (feedback.code === "installed") {
    return t("plugins.feedback.installed", {
      pluginId: bidiIsolate(feedback.pluginId),
      version: bidiIsolate(feedback.version),
    });
  }
  if (feedback.code === "removed") {
    return t("plugins.feedback.removed", { name: bidiIsolate(feedback.label) });
  }
  if (feedback.code === "remove-rejected") return t("plugins.feedback.removeRejected");
  return t("plugins.feedback.operationFailed", { detail: bidiIsolate(feedback.detail) });
}

const OFFICIAL_VIEWER_ICONS: Record<OfficialViewerIcon, LucideIcon> = {
  document: FileText,
  spreadsheet: Table2,
  presentation: Presentation,
  pdf: FileArchive,
  image: Image,
  media: Film,
};
