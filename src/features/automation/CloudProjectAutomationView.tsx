import { useEffect, useMemo, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import {
  listCloudAutomationProviderSpecs,
  openCloudApp,
  type DesktopCloudAutomationProviderSpec,
  type DesktopCloudSession,
} from "../../lib/cloudApi";
import { useSynchronizeBindings } from "./useSynchronizeBindings";
import { CloudAutomationPage } from "./AutomationPage";
import {
  buildCloudAutomationRows,
  cloudAutomationRowMatchesProvider,
  getCloudAutomationWebPath,
} from "./automationDomain";
import "./automation.css";

/** Automation for the single Project authorized by the current Git remote. */
export function CloudProjectAutomationView({
  projectId,
  cloudSession,
  activeProvider = null,
  onCloudSessionChange,
}: {
  projectId: string;
  cloudSession: DesktopCloudSession;
  activeProvider?: string | null;
  onCloudSessionChange: (session: DesktopCloudSession | null) => void;
}) {
  const { t } = useLocalization();
  const data = useSynchronizeBindings(projectId, cloudSession, onCloudSessionChange);
  const [detailRowId, setDetailRowId] = useState<string | null>(null);
  const [providerSpecs, setProviderSpecs] = useState<DesktopCloudAutomationProviderSpec[]>([]);
  const [providerSpecsLoading, setProviderSpecsLoading] = useState(true);
  const [providerSpecsError, setProviderSpecsError] = useState<string | null>(null);
  const automationRows = useMemo(
    () => buildCloudAutomationRows({
      projectId,
      bindings: data.bindings,
    }),
    [projectId, data.bindings],
  );
  const visibleRows = useMemo(
    () => automationRows.filter((row) => cloudAutomationRowMatchesProvider(row, activeProvider)),
    [activeProvider, automationRows],
  );
  const detailRow = visibleRows.find((row) => row.id === detailRowId) ?? null;

  useEffect(() => {
    let cancelled = false;
    setProviderSpecsLoading(true);
    setProviderSpecsError(null);
    void listCloudAutomationProviderSpecs(
      cloudSession,
      onCloudSessionChange,
      cloudSession.api_base_url ?? null,
    )
      .then((providers) => {
        if (!cancelled) setProviderSpecs(providers);
      })
      .catch((error) => {
        if (cancelled) return;
        setProviderSpecs([]);
        setProviderSpecsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setProviderSpecsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cloudSession, onCloudSessionChange]);

  useEffect(() => {
    if (detailRowId && !visibleRows.some((row) => row.id === detailRowId)) {
      setDetailRowId(null);
    }
  }, [detailRowId, visibleRows]);

  return (
    <>
      {data.error && (
        <div role="alert" className="desktop-dialog-error">
          {t("automation.error.detail", { detail: data.error })}
          <button type="button" onClick={() => void data.reload().catch(() => undefined)}>
            {t("common.action.retry")}
          </button>
        </div>
      )}
      <CloudAutomationPage
        key={JSON.stringify([cloudSession.api_base_url, cloudSession.user_id, cloudSession.session_generation, projectId])}
        projectId={projectId}
        cloudSession={cloudSession}
        apiBaseUrl={cloudSession.api_base_url ?? null}
        rows={visibleRows}
        totalCount={automationRows.length}
        hasAnyAutomation={automationRows.length > 0}
        loading={data.loading}
        providerSpecs={providerSpecs}
        providerSpecsLoading={providerSpecsLoading}
        providerSpecsError={providerSpecsError}
        detailRow={detailRow}
        onOpenRow={setDetailRowId}
        onCloseDetail={() => setDetailRowId(null)}
        onCloudSessionChange={onCloudSessionChange}
        onRefresh={data.reload}
        onOpenAutomation={() => openCloudApp(getCloudAutomationWebPath(projectId))}
      />
    </>
  );
}

