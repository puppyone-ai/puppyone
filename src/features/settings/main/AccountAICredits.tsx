import { useEffect } from "react";
import { useLocalization } from "@puppyone/localization";
import type { ModelConnectionSnapshot } from "../../../../shared/model-connections/types";
import { useModelConnections, type ModelConnectionStore } from "../../model-connections";
import { SettingsSubsection, SettingsValueRow } from "../components";

/**
 * Money, read as money. Six decimals is a machine's view of a micro-dollar
 * ledger; a balance is two. Sub-cent amounts keep enough digits to stay true
 * rather than rounding a real balance down to "$0.00".
 */
const money = (micro: number) => {
  const amount = micro / 1_000_000;
  const sub = amount > 0 && amount < 0.01;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: sub ? 4 : 2,
  }).format(amount);
};

/**
 * One balance, and — where money is spent — the top-up amounts the service
 * offers plus a manual read.
 *
 * Account states the balance and offers nothing to click: it reports what is
 * true. Buying more is a purchase, so it happens on Billing with every other
 * price. The number is the same number either way; it is polled on a timer and
 * on focus, so the stated balance needs no button to stay honest.
 */
function WalletRow({ credit, pending, store, topUp }: {
  credit: ModelConnectionSnapshot["managed"];
  pending: boolean;
  store: ModelConnectionStore;
  topUp: boolean;
}) {
  const { t } = useLocalization();
  const settling = credit.reason === "gateway-unavailable" || credit.reason === "loading";
  return <SettingsValueRow label={t("agent.compute.availableBalance")}
    value={settling ? "—" : money(credit.availableMicroUsd ?? 0)}
    action={topUp ? <>
      {(credit.packs ?? []).map((pack) => <button key={pack.id} type="button"
        className="desktop-settings-action primary" disabled={pending}
        onClick={() => void store.managed({ action: "checkout", packId: pack.id })}>
        {t("agent.compute.topUp", { amount: money(pack.price_cents * 10_000) })}
      </button>)}
      <button type="button" className="desktop-settings-action" disabled={pending}
        onClick={() => void store.managed({ action: "refresh" })}>{t("agent.compute.refreshBalance")}</button>
    </> : undefined} />;
}

/**
 * Personal billing stays available independently of experimental Cloud hosting.
 *
 * `payments` arrives from the Settings render entry, never from the stored
 * experiment: see `src/features/payments/README.md`. Without it this surface is
 * account sign-in and nothing else, and it issues no wallet read, so the
 * one-time trial credit is never claimed either.
 */
export function AccountAICredits({ payments, signedIn, topUp = false, title, detail }: {
  payments: boolean;
  signedIn: boolean;
  /**
   * Sell beside the balance. Plan sells when Cloud is on; without Cloud there is
   * no Plan, so Account sells. Elsewhere the balance is a statement.
   */
  topUp?: boolean;
  /** Set where the balance needs framing as the user's own compute. */
  title?: string;
  detail?: string;
  /** Retained so existing callers keep compiling; sign-in lives on Account. */
  onSignIn?: () => void;
  signInDisabled?: boolean;
}) {
  const { t } = useLocalization();
  const { state, store } = useModelConnections();
  const credit = state.snapshot?.managed;
  const showAccount = payments && signedIn && credit?.signedIn;
  const operationError = state.error === "AUTHENTICATION_FAILED"
    ? t("agent.compute.signInUnavailable")
    : t("agent.compute.paymentUnavailable");

  useEffect(() => {
    if (!payments) return;
    const refresh = () => { if (!document.hidden) void store.managed({ action: "refresh" }); };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [payments, store]);

  // Signed in with payment off leaves no row to show, and an empty subsection
  // would still draw a separator under the account. Signed out, the Account
  // page already owns the one sign-in call to action, so this surface stays
  // quiet instead of offering a second one.
  if (!payments || !signedIn) return null;

  // No heading by default: the row already says "Available balance", and a
  // title above it would only restate the label beneath it. A caller that is
  // framing the balance as something else passes its own.
  return <SettingsSubsection title={title} detail={detail}>
    {showAccount ? <WalletRow credit={credit} pending={state.pending.managed} store={store} topUp={topUp} /> : null}
    {((showAccount && (state.error || credit?.errorCode)) || state.error === "AUTHENTICATION_FAILED") &&
      <div className="desktop-settings-account-feedback danger" role="alert">{operationError}</div>}
  </SettingsSubsection>;
}
