import { AccessPointProviderIcon } from "../../access-points/presentation";
import { resolveAccessPointKind } from "../../access-points/model";
import { useLocalization } from "@puppyone/localization/react";
import {
  CREATE_ACCESS_INTENT_OPTIONS,
  getCreateAccessTileProvider,
  type CreateAccessIntent,
} from "./createAccessModel";

export function CreateAccessIntentPicker({
  value,
  onChange,
}: {
  value: CreateAccessIntent;
  onChange: (value: CreateAccessIntent) => void;
}) {
  const { t } = useLocalization();
  return (
    <section className="desktop-cloud-create-access-intent">
      <div className="desktop-cloud-create-access-intent-header">
        <div>
          <strong>{t("cloud.access.create.intentQuestion")}</strong>
        </div>
      </div>
      <div className="desktop-cloud-create-access-intent-grid">
        {CREATE_ACCESS_INTENT_OPTIONS.map((option) => {
          const active = value === option.id;
          const preview = option.preview ?? t(option.previewId!);
          const accessPointKind = resolveAccessPointKind(option.provider);
          return (
            <button
              key={option.id}
              className={`desktop-cloud-create-access-intent-option ${active ? "active" : ""}`}
              type="button"
              onClick={() => onChange(option.id)}
            >
              <span className="desktop-cloud-create-access-intent-title">
                <span className={`desktop-cloud-create-access-provider-tile ${getCreateAccessTileProvider(option.provider)} ${active ? "active" : ""}`} aria-hidden="true">
                  <AccessPointProviderIcon
                    kind={accessPointKind}
                    sourceProvider={option.provider}
                    size={accessPointKind === "git" ? 20 : 15}
                  />
                </span>
                <span>{t(option.labelId)}</span>
              </span>
              <span className={`desktop-cloud-create-access-intent-preview ${preview.includes("://") ? "mono" : ""}`}>
                {preview}
              </span>
              <span className="desktop-cloud-create-access-chip-list">
                {option.chipIds.map((chipId) => <span key={chipId}>{t(chipId)}</span>)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
