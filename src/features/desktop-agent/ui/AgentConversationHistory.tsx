import { useEffect, useId, useMemo, useState } from "react";
import { ArrowLeft, History, LoaderCircle, RefreshCw, Search } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import type {
  AgentRuntimeCatalogEntry,
  AgentSessionListItem,
  AgentSessionsListResponse,
} from "../domain/agent-contract";
import { AgentBrandMark } from "./AgentBrandMark";

type Props = {
  sessions: readonly AgentSessionListItem[];
  runtimes: readonly AgentRuntimeCatalogEntry[];
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  sources?: Readonly<Record<string, AgentSessionsListResponse["discovery"]>>;
  catalogTruncated?: boolean;
  openingSessionId?: string | null;
  onOpen: (session: AgentSessionListItem) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onBack: () => void;
};

/** Dedicated locator-only history browser; transcript data never enters this component. */
export function AgentConversationHistory({
  sessions,
  runtimes,
  loading,
  refreshing,
  loadingMore,
  hasMore,
  error,
  sources = {},
  catalogTruncated = false,
  openingSessionId = null,
  onOpen,
  onRefresh,
  onLoadMore,
  onBack,
}: Props) {
  const { t } = useLocalization();
  const titleId = useId();
  const [query, setQuery] = useState("");
  const runtimeById = useMemo(
    () => new Map(runtimes.map((entry) => [entry.descriptor.id, entry])),
    [runtimes],
  );
  const matchingSessions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return sessions;
    return sessions.filter((session) => {
      const runtimeId = session.runtimeId || session.runtime?.id || "";
      const runtimeLabel = session.runtime?.displayName
        || runtimeById.get(runtimeId)?.descriptor.displayName
        || runtimeId;
      return `${session.title}\n${runtimeLabel}`.toLocaleLowerCase().includes(normalized);
    });
  }, [query, runtimeById, sessions]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onBack();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onBack]);

  return (
    <section
      className="desktop-agent-history-view"
      aria-labelledby={titleId}
    >
      <header className="desktop-agent-history-toolbar">
        <button
          type="button"
          className="desktop-agent-history-toolbar-button"
          data-po-interaction="navigation"
          aria-label={t("agent.history.back")}
          title={t("agent.history.back")}
          onClick={onBack}
        >
          <ArrowLeft size={15} strokeWidth={1.7} aria-hidden="true" />
        </button>
        <h2 id={titleId}>{t("agent.history.title")}</h2>
        <button
          type="button"
          className="desktop-agent-history-toolbar-button"
          aria-label={t("agent.history.refresh")}
          title={t("agent.history.refresh")}
          disabled={loading || refreshing || loadingMore}
          onClick={onRefresh}
        >
          <RefreshCw
            className={refreshing ? "is-spinning" : undefined}
            size={12}
            strokeWidth={1.7}
            aria-hidden="true"
          />
        </button>
      </header>

      <label className="desktop-agent-history-search">
        <Search size={13} strokeWidth={1.7} aria-hidden="true" />
        <input
          autoFocus
          type="search"
          value={query}
          aria-label={t("agent.history.search")}
          placeholder={t("agent.history.search")}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>

      {loading ? (
        <div className="desktop-agent-history-empty" role="status">
          <LoaderCircle className="is-spinning" size={13} aria-hidden="true" />
          <span>{t("agent.history.loading")}</span>
        </div>
      ) : sessions.length === 0 && error ? (
        <div className="desktop-agent-history-empty" role="alert">
          <RefreshCw size={13} aria-hidden="true" />
          <span>{t("agent.history.refreshFailed")}</span>
        </div>
      ) : sessions.length === 0 ? (
        <div className="desktop-agent-history-empty" role="status">
          <History size={13} aria-hidden="true" />
          <span>{t("agent.history.empty")}</span>
        </div>
      ) : matchingSessions.length === 0 ? (
        <div className="desktop-agent-history-empty" role="status">
          <Search size={13} aria-hidden="true" />
          <span>{t("agent.history.noMatches")}</span>
        </div>
      ) : (
        <ul className="desktop-agent-history-list" data-po-scrollbar="sidebar">
          {matchingSessions.map((session) => {
            const runtimeId = session.runtimeId || session.runtime?.id || "";
            const runtime = runtimeById.get(runtimeId);
            const runtimeLabel = session.runtime?.displayName || runtime?.descriptor.displayName || runtimeId;
            return (
              <li key={session.id}>
                <button
                  type="button"
                  className="desktop-agent-history-option"
                  data-po-interaction="navigation"
                  aria-label={t("agent.history.open", { title: session.title })}
                  aria-busy={openingSessionId === session.id || undefined}
                  title={session.title}
                  disabled={openingSessionId !== null}
                  onClick={() => onOpen(session)}
                >
                  <AgentBrandMark
                    appearance="monochrome"
                    iconKey={session.runtime?.iconKey || runtime?.descriptor.iconKey || runtimeId}
                    label={runtimeLabel}
                  />
                  <span className="desktop-agent-history-copy">
                    <span className="desktop-agent-history-title">{session.title}</span>
                  </span>
                  <time className="desktop-agent-history-time" dateTime={session.updatedAt}>
                    {session.updatedAtKnown === false ? "" : formatHistoryDate(session.updatedAt)}
                  </time>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <footer className="desktop-agent-history-footer">
        {Object.entries(sources).map(([runtimeId, source]) => {
          const label = runtimeById.get(runtimeId)?.descriptor.displayName || runtimeId;
          const message = source.status === "failed" ? t("agent.history.refreshFailed")
            : source.status === "unsupported" ? t("agent.history.sourceUnsupported")
              : source.status === "partial" ? t("agent.history.sourcePartial")
                : source.coverage === "unknown" ? t("agent.history.sourceUnverified") : null;
          return message ? <p key={runtimeId} className={source.status === "failed" ? "desktop-agent-history-error" : "desktop-agent-history-source-status"} role="status">
            {label}: {message}
          </p> : null;
        })}
        {catalogTruncated && <p className="desktop-agent-history-error" role="status">{t("agent.history.catalogTruncated")}</p>}
        {hasMore && (
          <button
            type="button"
            className="desktop-agent-history-more"
            disabled={loadingMore || refreshing}
            onClick={onLoadMore}
          >
            {loadingMore ? t("agent.history.loadingMore") : t("agent.history.loadMore")}
          </button>
        )}
        {error && sessions.length > 0 && !Object.values(sources).some((source) => source.status === "failed") && (
          <p className="desktop-agent-history-error" role="status">{t("agent.history.refreshFailed")}</p>
        )}
      </footer>
    </section>
  );
}

function formatHistoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
