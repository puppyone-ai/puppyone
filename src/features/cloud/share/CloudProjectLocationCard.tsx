import type { MessageFormatter } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import { ArrowRight, Cloud, Laptop, LoaderCircle, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { ProjectLocationStatus } from "./projectLocationStatus";

/** Compact read-only answer to "where is this project available?". */
export function CloudProjectLocationCard({ status }: { status: ProjectLocationStatus }) {
  const { t } = useLocalization();
  const cloudState = status.kind === "resolving"
    ? "resolving"
    : status.kind === "attention"
      ? "attention"
      : status.kind === "local-cloud"
        ? "available"
        : null;

  return (
    <div className="desktop-project-location" data-project-location={status.kind}>
      <span className="desktop-project-location-eyebrow">{t("cloud.share.location.title")}</span>
      <strong className="desktop-project-location-summary">{projectLocationBadge(status, t)}</strong>

      <div className="desktop-project-location-path" aria-label={projectLocationBadge(status, t)}>
        <LocationNode
          icon={<Laptop size={18} strokeWidth={1.7} />}
          label={t("cloud.share.location.thisDevice")}
        />

        {cloudState && (
          <>
            <ArrowRight className="desktop-project-location-arrow" size={14} strokeWidth={1.6} aria-hidden="true" />
            <LocationNode
              icon={<Cloud size={18} strokeWidth={1.7} />}
              label={t("cloud.productName")}
              state={cloudState}
              stateIcon={cloudState === "resolving"
                ? <LoaderCircle className="animate-spin" size={13} strokeWidth={1.9} />
                : cloudState === "attention"
                  ? <TriangleAlert size={13} strokeWidth={1.9} />
                  : null}
            />
          </>
        )}
      </div>
    </div>
  );
}

function LocationNode({
  icon,
  label,
  state = "available",
  stateIcon = null,
}: {
  icon: ReactNode;
  label: string;
  state?: "available" | "resolving" | "attention";
  stateIcon?: ReactNode;
}) {
  return (
    <span
      className={`desktop-project-location-node${stateIcon ? " has-state" : ""}`}
      data-location-state={state}
    >
      <span className="desktop-project-location-icon" aria-hidden="true">{icon}</span>
      <span className="desktop-project-location-label">{label}</span>
      {stateIcon && <span className="desktop-project-location-state" aria-hidden="true">{stateIcon}</span>}
    </span>
  );
}

export function projectLocationBadge(status: ProjectLocationStatus, t: MessageFormatter): string {
  switch (status.kind) {
    case "local":
      return t("cloud.share.location.local");
    case "local-cloud":
      return t("cloud.share.location.localCloud");
    case "resolving":
      return t("cloud.share.location.resolving");
    case "attention":
      return t("cloud.share.location.attention");
  }
}
