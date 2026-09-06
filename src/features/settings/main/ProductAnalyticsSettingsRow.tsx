import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { useLocalization } from "@puppyone/localization";
import { DESKTOP_TELEMETRY_DISCLOSURE_URL } from "../../telemetry/publicDisclosure";
import type { DesktopTelemetryState } from "../../../types/electron";
import { SettingsToggle } from "../components";

export function ProductAnalyticsSettingsRow() {
  const { t } = useLocalization();
  const [state, setState] = useState<DesktopTelemetryState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const telemetry = window.puppyoneDesktop;
    if (!telemetry?.getTelemetryState || !telemetry.onTelemetryStateChanged) {
      setLoading(false);
      return undefined;
    }

    let active = true;
    void telemetry.getTelemetryState()
      .then((nextState) => {
        if (!active) return;
        setState(nextState);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError(true);
        setLoading(false);
      });
    const unsubscribe = telemetry.onTelemetryStateChanged((nextState) => {
      if (active) setState(nextState);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const updateAnalytics = useCallback(async (checked: boolean) => {
    const setTelemetryLevel = window.puppyoneDesktop?.setTelemetryLevel;
    if (!setTelemetryLevel || saving) return;
    setSaving(true);
    setError(false);
    try {
      setState(await setTelemetryLevel({ level: checked ? "basic" : "off" }));
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }, [saving]);

  const openDisclosure = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    const openExternalUrl = window.puppyoneDesktop?.openExternalUrl;
    if (!openExternalUrl) return;
    event.preventDefault();
    void openExternalUrl(DESKTOP_TELEMETRY_DISCLOSURE_URL);
  }, []);

  const title = t("settings.privacy.productAnalyze.title");
  const detail = t("settings.privacy.productAnalyze.detail");
  const canChange = Boolean(window.puppyoneDesktop?.setTelemetryLevel);

  return (
    <div className="desktop-settings-row desktop-settings-row-control" aria-busy={loading || saving}>
      <div className="desktop-product-analyze-label">
        <span title={detail}>{title}</span>
        <a
          className="desktop-product-analyze-learn-more"
          href={DESKTOP_TELEMETRY_DISCLOSURE_URL}
          onClick={openDisclosure}
          rel="noreferrer"
          target="_blank"
        >
          {t("settings.privacy.productAnalyze.learnMore")}
        </a>
        {error && (
          <small className="desktop-product-analytics-error" role="alert">
            {t("settings.privacy.productAnalyze.error")}
          </small>
        )}
      </div>
      <SettingsToggle
        checked={state?.noticeRequired ? false : state?.level !== "off"}
        description={detail}
        disabled={loading || saving || !canChange}
        label={title}
        onChange={(checked) => void updateAnalytics(checked)}
      />
    </div>
  );
}
