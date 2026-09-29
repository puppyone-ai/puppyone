import { Plus, Search } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import {
  type AccessPointCatalogKind,
  type AccessPointRow,
  type AccessPointStatusFilter,
} from "../model";
import {
  ACCESS_POINT_CATALOG_KINDS,
  getAccessPointCatalogPresentation,
} from "../presentation";
import { AccessPointList } from "./AccessPointList";
import "../styles/catalog-page.css";

export function AccessPointCatalogPage({
  routeKind,
  selectedKind,
  rows,
  totalRowCount,
  loading,
  selectedRowId,
  query,
  statusFilter,
  canManage,
  onKindChange,
  onQueryChange,
  onStatusFilterChange,
  onOpenRow,
  onCreate,
}: {
  routeKind: AccessPointCatalogKind;
  selectedKind: AccessPointCatalogKind;
  rows: readonly AccessPointRow[];
  totalRowCount: number;
  loading: boolean;
  selectedRowId: string | null;
  query: string;
  statusFilter: AccessPointStatusFilter;
  canManage: boolean;
  onKindChange: (kind: AccessPointCatalogKind) => void;
  onQueryChange: (query: string) => void;
  onStatusFilterChange: (status: AccessPointStatusFilter) => void;
  onOpenRow: (row: AccessPointRow) => void;
  onCreate: () => void;
}) {
  const { t } = useLocalization();
  const presentation = getAccessPointCatalogPresentation(routeKind, t);
  const emptyPresentation = getAccessPointCatalogPresentation(selectedKind, t);
  const noMatches = Boolean(query.trim()) || statusFilter !== "all";
  const emptyTitle = noMatches ? t("cloud.access.noMatches") : emptyPresentation.emptyTitle;
  const emptyDetail = noMatches ? emptyPresentation.description : emptyPresentation.emptyDetail;

  return (
    <section className="desktop-cloud-access-page desktop-cloud-access-catalog-page">
      <main className="desktop-cloud-access-canvas" data-po-scrollbar="content">
        <div className="desktop-cloud-access-catalog">
          <header className="desktop-cloud-access-landing-header">
            <div className="desktop-cloud-access-landing-copy">
              <h1>{presentation.title}</h1>
              <p>{presentation.description}</p>
            </div>
            {canManage && (
              <button className="desktop-cloud-access-new-button" type="button" onClick={onCreate}>
                <Plus size={14} />
                <span>{t(routeKind === "mcp" ? "cloud.access.create.intent.agent.label" : "cloud.access.new")}</span>
              </button>
            )}
          </header>

          <div className={`desktop-cloud-access-toolbar ${routeKind === "all" ? "" : "focused"}`}>
            {routeKind === "all" && (
              <nav
                className="desktop-cloud-access-category-tabs"
                data-po-scrollbar="hidden"
                aria-label={t("cloud.access.filterAria")}
                role="tablist"
              >
                {ACCESS_POINT_CATALOG_KINDS.map((item) => {
                  const itemPresentation = getAccessPointCatalogPresentation(item, t);
                  const active = selectedKind === item;
                  return (
                    <button
                      key={item}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className={active ? "active" : undefined}
                      onClick={() => onKindChange(item)}
                    >
                      {itemPresentation.label}
                    </button>
                  );
                })}
              </nav>
            )}
            <div className="desktop-cloud-access-filter-controls">
              <label className="desktop-cloud-access-catalog-search">
                <Search size={14} aria-hidden="true" />
                <input
                  value={query}
                  aria-label={t("cloud.access.search")}
                  placeholder={t("cloud.access.search")}
                  onChange={(event) => onQueryChange(event.target.value)}
                />
              </label>
              <select
                className="desktop-cloud-access-status-filter"
                value={statusFilter}
                aria-label={t("cloud.access.filterAria")}
                onChange={(event) => onStatusFilterChange(event.target.value as AccessPointStatusFilter)}
              >
                {(["all", "active", "inactive"] as const).map((status) => (
                  <option key={status} value={status}>{t(`cloud.access.filterState.${status}`)}</option>
                ))}
              </select>
            </div>
          </div>

          <section className="desktop-cloud-access-list-section" aria-label={t("cloud.access.resources")}>
            <AccessPointList
              rows={rows}
              totalRowCount={totalRowCount}
              selectedRowId={selectedRowId}
              loading={loading}
              emptyDefinition={emptyPresentation}
              emptyTitle={emptyTitle}
              emptyDetail={emptyDetail}
              onOpen={onOpenRow}
            />
          </section>
        </div>
      </main>
    </section>
  );
}
