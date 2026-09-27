import { Tooltip } from "@puppyone/shared-ui";
import { AccessPointProviderIcon } from "../../access-points/presentation";
import { useLocalization } from "@puppyone/localization/react";
import { getAccessProviderLabel } from "./createAccessModel";

export function CreateAccessMethodRow({
  provider,
  description,
  locked = false,
  disabled = false,
  checked = false,
  onCheckedChange,
}: {
  provider: string;
  description: string;
  locked?: boolean;
  disabled?: boolean;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}) {
  const { t } = useLocalization();
  const inactive = disabled && !locked;
  const enabled = locked || checked;
  const providerLabel = getAccessProviderLabel(provider, t);

  return (
    <div className={`desktop-cloud-create-access-method-row ${enabled ? "enabled" : ""} ${inactive ? "inactive" : ""}`}>
      <span className="desktop-cloud-create-access-method-icon" aria-hidden="true">
        <AccessPointProviderIcon sourceProvider={provider} size={16} />
      </span>
      <div className="desktop-cloud-create-access-method-copy">
        <div>
          <span>{providerLabel}</span>
          {inactive ? <em>{t("cloud.common.soon")}</em> : null}
        </div>
        <p>{description}</p>
      </div>
      <CreateAccessSwitch
        checked={enabled}
        disabled={disabled}
        tooltip={locked ? t("cloud.access.create.alreadyEnabled") : disabled ? t("cloud.common.comingSoon") : undefined}
        ariaLabel={t("cloud.access.create.methodToggle", {
          method: providerLabel,
          state: t(enabled ? "cloud.common.on" : "cloud.common.off"),
        })}
        onChange={locked || disabled ? undefined : onCheckedChange}
      />
    </div>
  );
}

function CreateAccessSwitch({
  checked,
  disabled,
  tooltip,
  ariaLabel,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  tooltip?: string;
  ariaLabel: string;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <Tooltip content={tooltip}><button
      className={`desktop-cloud-create-access-switch ${checked ? "checked" : ""}`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
                             >
      <span />
    </button></Tooltip>
  );
}
