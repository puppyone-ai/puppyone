import { useMemo, useRef, useState } from "react";
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
  excludedSessionCount?: number;
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
  excludedSessionCount = 0,
  openingSessionId = null,
  onOpen,
  onRefresh,
  onLoadMore,
  onBack,
}: Props) {
  const { t } = useLocalization();
  const searchButton = useRef<HTMLButtonElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
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

  const sourceEntries = Object.entries(sources);
  const sourceFailed = sourceEntries.some(([, source]) => source.status === "failed");
  const complete = sourceEntries.length > 0 && !catalogTruncated && !hasMore
    && sourceEntries.every(([, source]) => source.status === "complete" && source.coverage === "complete")
    && runtimes.every((runtime) => sources[runtime.descriptor.id]?.coverage === "complete");
  // An empty projection is not proof of an empty native history.
  const emptyMessage = error || sourceFailed ? "agent.history.refreshFailed"
    : excludedSessionCount > 0 ? "agent.history.alreadyOpen"
      : complete ? "agent.history.empty" : "agent.history.notFound";
  const sourceNotes = sourceEntries.flatMap(([runtimeId, source]) => {
    const message = source.status === "unsupported" ? "agent.history.sourceUnsupported"
      : source.status === "partial" ? "agent.history.sourcePartial"
        : source.status !== "failed" && source.coverage !== "complete" ? "agent.history.sourceUnverified" : null;
    return message ? [{ runtimeId, message }] : [];
  });

  return (
    <section
      className="desktop-agent-history-view"
      aria-label={t("agent.history.title")}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        if (searchOpen) {
          setQuery("");
          setSearchOpen(false);
          requestAnimationFrame(() => searchButton.current?.focus());
        } else onBack();
      }}
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
        <div className="desktop-agent-history-search-slot">
          <button
            ref={searchButton}
            type="button"
            className="desktop-agent-history-toolbar-button"
            hidden={searchOpen}
            aria-label={t("agent.history.search")}
            title={t("agent.history.search")}
            aria-expanded={searchOpen}
            onClick={() => setSearchOpen(true)}
          >
            <Search size={15} strokeWidth={1.7} aria-hidden="true" />
          </button>
          {searchOpen && <label className="desktop-agent-history-search">
            <Search size={13} strokeWidth={1.7} aria-hidden="true" />
            <input
              autoFocus
              type="search"
              value={query}
              aria-label={t("agent.history.search")}
              placeholder={t("agent.history.search")}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>}
        </div>
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

      {loading ? (
        <div className="desktop-agent-history-empty" role="status">
          <LoaderCircle className="is-spinning" size={13} aria-hidden="true" />
          <span>{t("agent.history.loading")}</span>
        </div>
      ) : sessions.length === 0 ? (
        <div className="desktop-agent-history-empty" role={error || sourceFailed ? "alert" : "status"}>
          <History size={13} aria-hidden="true" />
          <span>{t(emptyMessage)}</span>
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
        {sourceEntries.filter(([, source]) => source.status === "failed").map(([runtimeId]) => {
          const label = runtimeById.get(runtimeId)?.descriptor.displayName || runtimeId;
          return <p key={runtimeId} className="desktop-agent-history-error" role="status">
            {label}: {t("agent.history.refreshFailed")}
          </p>;
        })}
        {sourceNotes.length > 0 && <details className="desktop-agent-history-source-details">
          <summary>{t("agent.history.sourceSummary")}</summary>
          {sourceNotes.map(({ runtimeId, message }) => <p key={runtimeId} className="desktop-agent-history-source-status">
            {runtimeById.get(runtimeId)?.descriptor.displayName || runtimeId}: {t(message)}
          </p>)}
        </details>}
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
        {error && sessions.length > 0 && !sourceFailed && (
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
