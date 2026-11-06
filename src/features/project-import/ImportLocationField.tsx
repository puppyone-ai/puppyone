import { useEffect, useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization";
import type { WorkspaceProjectLocationGrant } from "../../types/electron";
import { FolderIcon } from "@puppyone/shared-ui";

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
  const defaultRequest = useRef<Promise<WorkspaceProjectLocationGrant | null> | null>(null);

  useEffect(() => {
    if (!onDefaultLocation) { setResolvingDefault(false); return; }
    // Reattach to one request when Strict Mode replays the effect or the parent
    // supplies a new callback identity. A cancelled subscriber must not leave
    // the next subscriber waiting forever.
    defaultRequest.current ??= Promise.resolve().then(onDefaultLocation);
    let cancelled = false;
    void defaultRequest.current.then((grant) => {
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
  const idleAction = location ? "onboarding.entry.create.change" : "onboarding.entry.create.browse";
  const action = choosing ? "onboarding.entry.create.browsing" : idleAction;
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
        <FolderIcon aria-hidden="true" />
        <bdi
          className={`onboarding-entry-location-path ${location ? "is-selected" : ""}`}
          dir="ltr"
          aria-live="polite"
        >
          {location?.path ?? t("onboarding.entry.import.saveToPicker")}
        </bdi>
        <span className="onboarding-entry-location-action">
          {t(action)}
        </span>
      </button>
    </div>
  );
}
