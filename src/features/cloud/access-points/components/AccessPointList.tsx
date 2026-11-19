import { PlaceholderLayer } from "@puppyone/shared-ui";
import type { AccessPointRow as AccessPointRowModel } from "../model";
import type { AccessPointCatalogDefinition } from "../presentation";
import { AccessPointEmptyState } from "./AccessPointEmptyState";
import { AccessPointRow } from "./AccessPointRow";
import "../styles/access-point-list.css";

export function AccessPointList({
  rows,
  totalRowCount,
  selectedRowId,
  loading,
  emptyDefinition,
  emptyTitle,
  emptyDetail,
  onOpen,
}: {
  rows: readonly AccessPointRowModel[];
  totalRowCount: number;
  selectedRowId: string | null;
  loading: boolean;
  emptyDefinition: AccessPointCatalogDefinition;
  emptyTitle: string;
  emptyDetail: string;
  onOpen: (row: AccessPointRowModel) => void;
}) {
  if (loading && totalRowCount === 0) {
    return (
      <div className="desktop-cloud-access-point-list po-placeholder-surface" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="desktop-cloud-access-point-row skeleton" key={index}>
            <span data-placeholder-shape="" />
            <span data-placeholder-shape="" />
            <span data-placeholder-shape="" />
          </div>
        ))}
        <PlaceholderLayer />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <AccessPointEmptyState
        definition={emptyDefinition}
        title={emptyTitle}
        detail={emptyDetail}
      />
    );
  }

  return (
    <div className="desktop-cloud-access-point-list">
      {rows.map((row) => (
        <AccessPointRow
          key={row.id}
          row={row}
          selected={row.id === selectedRowId}
          onOpen={() => onOpen(row)}
        />
      ))}
    </div>
  );
}
