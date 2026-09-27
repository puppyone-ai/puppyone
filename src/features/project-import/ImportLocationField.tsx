import { FolderOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization";
import type { WorkspaceProjectLocationGrant } from "../../types/electron";

export function useImportLocation({
  onDefaultLocation,
  onChooseLocation,
}: {
  onDefaultLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onChooseLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
}) {
  const [location, setLocation] = useState<WorkspaceProjectLocationGrant | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [resolvingDefault, setResolvingDefault] = useState(Boolean(onDefaultLocation));
  const [error, setError] = useState<string | null>(null);
  const requestedDefault = useRef(false);

  useEffect(() => {
    if (!onDefaultLocation || requestedDefault.current) return;
    requestedDefault.current = true;
    let cancelled = false;
    void onDefaultLocation().then((grant) => {
      if (!cancelled && grant) setLocation((current) => current ?? grant);
    }).catch(() => {
      // Main asks for a destination if the default could not be granted.
    }).finally(() => {
      if (!cancelled) setResolvingDefault(false);
    });
    return () => { cancelled = true; };
  }, [onDefaultLocation]);

  const choose = async () => {
    if (!onChooseLocation || choosing || resolvingDefault) return;
    setError(null);
    setChoosing(true);
    try {
      const grant = await onChooseLocation();
      if (grant) setLocation(grant);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setChoosing(false);
    }
  };

  return { location, choosing, resolvingDefault, error, choose, canChoose: Boolean(onChooseLocation) };
}

export function ImportLocationField({
  location,
  choosing,
  disabled,
  canChoose,
  onChoose,
}: {
  location: WorkspaceProjectLocationGrant | null;
  choosing: boolean;
  disabled: boolean;
  canChoose: boolean;
  onChoose: () => void;
}) {
  const { t } = useLocalization();
  return (
    <div className="onboarding-entry-create-field onboarding-import-location">
      <span className="onboarding-entry-create-label">{t("onboarding.entry.import.saveTo")}</span>
      <button
        className="onboarding-entry-location-picker onboarding-entry-browse-button"
        type="button"
        disabled={disabled || !canChoose}
        aria-label={t("onboarding.entry.import.saveTo")}
        onClick={onChoose}
      >
        <FolderOpen aria-hidden="true" />
        <bdi
          className={`onboarding-entry-location-path ${location ? "is-selected" : ""}`}
          dir="ltr"
          data-tooltip={location?.path}
          aria-live="polite"
        >
          {location?.path ?? t("onboarding.entry.import.saveToPicker")}
        </bdi>
        <span className="onboarding-entry-location-action">
          {t(choosing
            ? "onboarding.entry.create.browsing"
            : location
              ? "onboarding.entry.create.change"
              : "onboarding.entry.create.browse")}
        </span>
      </button>
    </div>
  );
}
