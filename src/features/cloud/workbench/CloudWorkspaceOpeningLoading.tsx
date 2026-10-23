import { useLocalization } from "@puppyone/localization";
import { PageLoading } from "../../../components/loading";
import type { CloudWorkspaceOpeningPhase } from "../files/cloudWorkspaceOpening";

const labels = {
  checking: "cloud.loading.connectingCloud",
  connecting: "cloud.loading.startingWorkspace",
  files: "cloud.loading.files",
} as const;

export function CloudWorkspaceOpeningLoading({ phase }: { phase: CloudWorkspaceOpeningPhase }) {
  const { t } = useLocalization();
  return <PageLoading variant="fill" label={t(labels[phase])} />;
}
