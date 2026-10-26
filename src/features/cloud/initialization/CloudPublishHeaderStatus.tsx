import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import { formatCloudPublishTransfer, getCloudPublishProgressLabel } from "./CloudPublishProgressIndicator";
import type { CloudPublishHeaderStatus as CloudPublishHeaderStatusValue } from "./useCloudPublishHeaderStatus";
import "./cloud-publish-header-status.css";

/**
 * A Header control beside the project's place, present only while a first
 * publish runs unwatched, has just ended, or waits unfinished. It is the way
 * back to the run, so it is a button and not a badge. It is a mark alone: the
 * state's words live in its tooltip and accessible name, so it never widens
 * the Header.
 */
export function CloudPublishHeaderStatus({ status, onOpen }: {
  status: CloudPublishHeaderStatusValue | null;
  onOpen: () => void;
}) {
  const { t, formatNumber } = useLocalization();
  if (!status) return null;
  // A discard that did not finish is stated as itself: offering to retry a
  // send the user already chose to discard would invite the opposite.
  const key = status.kind === "paused" && status.discard ? "discardPaused" : status.kind;
  const label = t(`cloud.initialize.header.${key}`);
  // While files are moving, the reading is the detail: the Header is where an
  // unwatched send is checked on, and "45% · 12.3 MB · 1.1 MB/s" answers it.
  let detail: string;
  if (status.kind !== "running") detail = t(`cloud.initialize.header.${key}Detail`);
  else if (status.stage === "uploading" && status.transfer) {
    detail = formatCloudPublishTransfer(status.transfer, formatNumber);
  } else detail = getCloudPublishProgressLabel(status.stage, t);
  const description = `${label}. ${detail}`;
  return (
    <div className="desktop-titlebar-publish-status-wrap">
      <Tooltip content={description}>
        <button
          type="button"
          className="desktop-titlebar-publish-status"
          data-publish-status={status.kind}
          aria-label={description}
          onClick={onOpen}
        >
          <span className="desktop-titlebar-publish-status-mark" aria-hidden="true">
            <CloudPublishHeaderMark status={status} />
          </span>
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * Three marks for three facts. Sending is the same spinner the publish dialog
 * draws on its current step, so the Header and the dialog read as one run.
 * Anything that did not finish, whether it failed just now or was interrupted
 * earlier, is a warning: it is not a pause the user chose, it is work that
 * still needs them. Done is a check.
 */
function CloudPublishHeaderMark({ status }: { status: CloudPublishHeaderStatusValue }) {
  if (status.kind === "running") {
    return <LoaderCircle className="desktop-titlebar-publish-status-spinner animate-spin" size={14} strokeWidth={2.2} />;
  }
  if (status.kind === "completed") return <Check size={14} strokeWidth={2.2} />;
  return <TriangleAlert size={14} strokeWidth={2.1} />;
}
