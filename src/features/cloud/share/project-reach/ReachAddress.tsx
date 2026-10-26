import { useLocalization } from "@puppyone/localization/react";
import { Link2, Plug } from "lucide-react";
import { getDesktopCloudWebUrl } from "../../../../lib/cloudApi";
import { normalizeApiOrigin } from "../shareHandoff";

/**
 * The link, before it exists.
 *
 * One row, one job: this is where the link lives. The address is real and
 * only the part that does not exist yet is masked, so the row is a promise
 * the product can keep rather than a decoration — and the two halves are not
 * drawn alike. What is already true is coloured as what it is, a link; what
 * has not been decided is dots in grey, and reads like it.
 *
 * That colour is the emphasis. The address is the one thing on this screen
 * the user is going to hand to somebody, and every reader alive already
 * knows what a blue piece of text is for — so it does not need a badge, a
 * heavier weight, or a panel of its own to be found. Half a line of accent
 * is cheaper than any of them and says more.
 *
 * The verb stands in the row only when pressing it does nothing but mint a
 * link. Nothing else does: a button for handing the address on cannot be
 * offered before there is an address, and a drawing of one was just a target
 * for a click that would do nothing.
 */
export function ReachLinkRow({ action, kind = "link", apiBaseUrl = null, onCreate }: {
  action?: string;
  /** A person follows a link; an MCP agent is given an address of its own. */
  kind?: "link" | "address";
  apiBaseUrl?: string | null;
  onCreate?: () => void;
}) {
  const { t } = useLocalization();
  const address = kind === "address";
  const shape = address ? pendingAddressShape(apiBaseUrl) : pendingLinkShape();
  return (
    <div
      className="desktop-reach-link-row"
      role="group"
      aria-label={t(address
        ? "cloud.share.reach.connect.addressPending"
        : "cloud.share.reach.invite.linkPending")}
    >
      <span className="desktop-reach-link-mark" aria-hidden="true">
        {address ? <Plug size={15} strokeWidth={1.8} /> : <Link2 size={15} strokeWidth={1.8} />}
      </span>
      <code className="desktop-reach-link-value" aria-hidden="true" dir="ltr">
        <span className="desktop-reach-link-known">{shape.known}</span>
        <span className="desktop-reach-link-pending">{shape.pending}</span>
      </code>
      {action && (
        <button
          type="button"
          className="desktop-reach-link-action"
          data-desktop-dialog-initial-focus="true"
          onClick={onCreate}
        >
          {action}
        </button>
      )}
    </div>
  );
}

/** Everything in the address that is already true, and everything that is not. */
type PendingAddress = Readonly<{ known: string; pending: string }>;

const MASKED = "•".repeat(10);

function pendingLinkShape(): PendingAddress {
  try {
    return { known: `${new URL(getDesktopCloudWebUrl("/")).host}/r/`, pending: MASKED };
  } catch {
    return { known: "puppyone.ai/r/", pending: MASKED };
  }
}

/**
 * The proxy address is known before issuance. Its bearer credential is
 * handed off separately and never belongs in the URL.
 */
function pendingAddressShape(apiBaseUrl: string | null): PendingAddress {
  try {
    const { host } = new URL(normalizeApiOrigin(apiBaseUrl));
    return { known: `${host}/api/v1/mcp/proxy`, pending: "" };
  } catch {
    return { known: "puppyone.ai/api/v1/mcp/proxy", pending: "" };
  }
}
