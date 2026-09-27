import { ChevronRight } from "lucide-react";
import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import { getScopeDisplayName, getScopePathLabel } from "../../utils";
import type { AccessPointRow as AccessPointRowModel } from "../model";
import {
  AccessPointIcon,
  formatAccessPointTitle,
  getAccessPointUiDefinition,
} from "../presentation";
import { AccessPointStatus } from "./AccessPointStatus";

export function AccessPointRow({
  row,
  selected,
  onOpen,
}: {
  row: AccessPointRowModel;
  selected: boolean;
  onOpen: () => void;
}) {
  const { t } = useLocalization();
  const { accessPoint, scope } = row;
  const title = formatAccessPointTitle(accessPoint, t);
  const scopeName = getScopeDisplayName(scope, t);
  const scopePath = getScopePathLabel(scope);
  const definition = getAccessPointUiDefinition(accessPoint.kind);
  const modeLabel = t(scope.max_mode === "rw" ? "cloud.scope.readWrite" : "cloud.scope.readOnly");

  return (
    <button
      className={`desktop-cloud-access-point-row ${selected ? "selected" : ""}`}
      type="button"
      data-tooltip={`${title} · ${bidiIsolate(scopeName)} · ${bidiIsolate(scopePath)}`}
      onClick={onOpen}
    >
      <span className={`desktop-cloud-access-point-icon ${definition.tileProvider}`} aria-hidden="true">
        <AccessPointIcon
          accessPoint={accessPoint}
          size={definition.iconSize === 34 ? 18 : definition.iconSize}
        />
      </span>
      <span className="desktop-cloud-access-point-copy">
        <strong dir="auto">{title}</strong>
        <span>
          <span dir="auto">{scopeName}</span>
          <code data-tooltip={scopePath}>{scopePath}</code>
        </span>
      </span>
      <span className="desktop-cloud-access-point-right">
        <span className="desktop-cloud-access-point-meta">
          <AccessPointStatus status={accessPoint.status} />
          <span>{modeLabel}</span>
        </span>
        <span className="desktop-cloud-access-point-manage">
          {t("cloud.access.open")}
          <ChevronRight className="po-directional-icon" size={13} />
        </span>
      </span>
    </button>
  );
}
