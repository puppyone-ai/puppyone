import { useLocalization } from "@puppyone/localization";

/**
 * Who you are, stated once.
 *
 * The email already proves the session, so there is no status row saying
 * "Signed in" next to it — a label that only ever restates the value beside it
 * is noise. Signing out is rare and destructive, so it reads as a quiet text
 * action rather than the loudest control on the page.
 *
 * The mark is a round initial. The product knows an email and nothing more,
 * and inventing a portrait would claim an identity it was never given — the
 * same rule the reach marks already follow.
 *
 * What the account holds is not repeated here. It is stated once, below, next
 * to the machines it refers to; a second copy under the email was one fact
 * with two sources and no way to tell which was stale.
 */
export function AccountIdentity({
  email,
  statusNote,
  busy,
  onSignOut,
}: {
  email: string | null;
  /** Only set when the session needs explaining (restoring, offline, …). */
  statusNote: string | null;
  busy: boolean;
  onSignOut: () => void;
}) {
  const { t } = useLocalization();
  const signedIn = Boolean(email);
  // Signed out, the one line worth adding is why an account exists at all.
  const meta = signedIn ? null : t("settings.account.signedOutDetail");

  return (
    <header className="desktop-account-identity">
      <span className="desktop-account-avatar" aria-hidden="true">
        {signedIn ? initial(email ?? "") : null}
      </span>
      <div className="desktop-account-identity-text">
        <strong dir="auto">{email ?? t("settings.account.notSignedIn")}</strong>
        {meta && <span className="desktop-account-identity-meta">{meta}</span>}
        {statusNote && <span className="desktop-account-identity-status">{statusNote}</span>}
      </div>
      {signedIn && (
        <button
          type="button"
          className="desktop-account-signout"
          disabled={busy}
          onClick={onSignOut}
        >
          {t("settings.account.signOut")}
        </button>
      )}
    </header>
  );
}

function initial(value: string): string {
  return [...value.trim()][0]?.toLocaleUpperCase() ?? "";
}
