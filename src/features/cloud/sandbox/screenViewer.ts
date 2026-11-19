import type { CloudScreenSession } from "../files/contracts";

/** What a viewer reports; the screen view owns retries and copy. */
export type CloudScreenViewerStatus = "connecting" | "connected" | "disconnected";

export type CloudScreenViewerProps = {
  session: CloudScreenSession;
  interactive?: boolean;
  onStatus: (status: CloudScreenViewerStatus) => void;
};
