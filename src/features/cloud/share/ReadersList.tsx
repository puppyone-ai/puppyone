import { bidiIsolate } from "@puppyone/localization";
import { useLocalization } from "@puppyone/localization/react";
import { LoaderCircle } from "lucide-react";
import { formatRelativeTime } from "../utils";
import type { ProjectShare } from "./useProjectShares";
import type { ProjectShareRevoke } from "./useProjectShareRevoke";
import "./readers-list.css";

/**
 * Who can reach this project, and the one action the list owns: stopping it.
 *
 * The Header states reach and the Share screen confirms it; both show the same
 * rows, in the same order, with the same facts — what each one can reach, what
 * it can do with it, and when it last read anything. Keeping that in one
 * component is what keeps the two answers identical.
 *
 * Every row is a fact. Nothing here persuades, and a project nobody reaches
 * says so in one quiet line instead of offering to fix it.
 */
export function ReadersList({
  readers,
  revoke,
  emptyLabel,
}: {
  readers: readonly ProjectShare[];
  revoke: ProjectShareRevoke;
  /** Shown instead of the list when nobody reaches the project. */
  emptyLabel?: string;
}) {
  const localization = useLocalization();
  const { t } = localization;

  if (readers.length === 0) {
    return (
      <p className="desktop-readers-empty">{emptyLabel ?? t("cloud.share.reach.readers.empty")}</p>
    );
  }

  return (
    <>
      <ul className="desktop-readers-list" aria-label={t("cloud.share.reach.readers.listLabel")}>
        {readers.map((share) => {
          const confirming = revoke.confirmingId === share.id;
          const pending = revoke.pendingId === share.id;
          return (
            <li className="desktop-readers-row" key={share.id} data-confirming={confirming || undefined}>
              <span
                className="desktop-readers-presence"
                data-read={Boolean(share.lastSeenAt)}
                aria-hidden="true"
              />
              <span className="desktop-readers-identity">
                <strong dir="auto">{share.name}</strong>
                <small>
                  {share.path
                    ? <bdi>{share.path}</bdi>
                    : t("cloud.share.reach.readers.wholeProject")}
                  {" · "}
                  {t(share.readonly
                    ? "cloud.share.reach.readers.canRead"
                    : "cloud.share.reach.readers.canChange")}
                  {" · "}
                  {share.lastSeenAt
                    ? t("cloud.share.reach.readers.lastRead", {
                      time: formatRelativeTime(share.lastSeenAt, localization),
                    })
                    : t("cloud.share.reach.readers.neverRead")}
                </small>
              </span>
              {confirming ? (
                <span className="desktop-readers-confirm">
                  <span dir="auto">
                    {t("cloud.share.reach.readers.stopConsequence", {
                      name: bidiIsolate(share.name),
                    })}
                  </span>
                  <button
                    type="button"
                    className="desktop-dialog-button destructive"
                    disabled={pending}
                    onClick={() => void revoke.stop(share)}
                  >
                    {pending && (
                      <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
                    )}
                    {t("cloud.share.reach.readers.stop")}
                  </button>
                  <button
                    type="button"
                    className="desktop-readers-quiet"
                    disabled={pending}
                    onClick={revoke.dismiss}
                  >
                    {t("cloud.share.reach.readers.keep")}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="desktop-readers-quiet desktop-readers-stop"
                  disabled={!revoke.available}
                  onClick={() => revoke.ask(share.id)}
                >
                  {t("cloud.share.reach.readers.stop")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {revoke.failed && (
        <p className="desktop-readers-error" role="alert">
          {t("cloud.share.reach.readers.stopFailed")}
        </p>
      )}
    </>
  );
}
