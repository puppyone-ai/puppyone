import type { HistoryContext } from "./historyRepository";
import type { DesktopCloudHistory } from "../../../lib/cloudHistoryApi";
import type { CloudBranchGraphRow } from "../graph/model";

export type CloudProjectHistoryProps = {
  projectId: string | null;
  context?: HistoryContext;
  projectName: string;
  history: DesktopCloudHistory | null;
  rows: CloudBranchGraphRow[];
  selectedCommitId: string | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  warning: string | null;
  onSelectCommit: (commitId: string) => void;
  onRefresh: () => void | Promise<void>;
  onLoadMore: () => void | Promise<void>;
};
