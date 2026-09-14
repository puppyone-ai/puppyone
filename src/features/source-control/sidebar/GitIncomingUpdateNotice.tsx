import { useLocalization } from "@puppyone/localization";
import { GitOperationButton } from "./GitSidebarPrimitives";

export function GitIncomingUpdateNotice({
  count,
  diverged,
  title,
  disabled,
  operationLoading,
  primary,
  onPull,
}: Readonly<{
  count: number;
  diverged: boolean;
  title: string;
  disabled: boolean;
  operationLoading: string | null;
  primary: boolean;
  onPull: () => Promise<boolean>;
}>) {
  const { t } = useLocalization();

  return (
    <aside
      className="desktop-git-incoming-notice"
      data-diverged={diverged ? "true" : undefined}
      role="status"
      aria-live="polite"
    >
      <span className="desktop-git-incoming-notice-summary">
        {t("source-control.commit.commits", { count })}
      </span>
      <GitOperationButton
        className="desktop-git-incoming-notice-pull"
        title={title}
        disabled={disabled}
        icon="download"
        label={t("source-control.sync.pull")}
        loadingKey="pull"
        loadingLabel={t("source-control.sync.pulling")}
        operationLoading={operationLoading}
        primary={primary}
        onClick={() => void onPull()}
      />
    </aside>
  );
}
