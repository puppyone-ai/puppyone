import { lazy, Suspense } from "react";
import { useLocalization } from "@puppyone/localization/react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";

const LazyCloudProjectAutomationView = lazy(() => import("../../automation/CloudProjectAutomationView").then((module) => ({
  default: module.CloudProjectAutomationView,
})));

/** Automation loads Synchronize resources, never the aggregate Access inventory. */
export function CloudAutomationRouteSection({
  projectId,
  cloudSession,
  onSessionChange,
}: {
  projectId: string;
  cloudSession: DesktopCloudSession;
  onSessionChange: (session: DesktopCloudSession | null) => void;
}) {
  const { t } = useLocalization();
  return (
    <Suspense fallback={<div className="desktop-view-route-loading" role="status">{t("cloud.loading.automation")}</div>}>
      <LazyCloudProjectAutomationView
        projectId={projectId}
        cloudSession={cloudSession}
        activeProvider={null}
        onCloudSessionChange={onSessionChange}
      />
    </Suspense>
  );
}
