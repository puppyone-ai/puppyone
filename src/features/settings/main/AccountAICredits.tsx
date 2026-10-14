import { useEffect } from "react";
import { useLocalization } from "@puppyone/localization";
import type { ModelConnectionSnapshot } from "../../../../shared/model-connections/types";
import { useModelConnections, type ModelConnectionStore } from "../../model-connections";
import { SettingsSubsection, SettingsValueRow } from "../components";

const money = (micro: number) => new Intl.NumberFormat(undefined, {
  style: "currency", currency: "USD", maximumFractionDigits: 6,
}).format(micro / 1_000_000);

/** One balance, the top-up amounts the service offers, and a manual read. */
function WalletRow({ credit, pending, store }: {
  credit: ModelConnectionSnapshot["managed"];
  pending: boolean;
  store: ModelConnectionStore;
}) {
  const { t } = useLocalization();
  const settling = credit.reason === "gateway-unavailable" || credit.reason === "loading";
  return <SettingsValueRow label={t("agent.compute.availableBalance")}
    value={settling ? "—" : money(credit.availableMicroUsd ?? 0)}
    action={<>
      {(credit.packs ?? []).map((pack) => <button key={pack.id} type="button"
        className="desktop-settings-action primary" disabled={pending}
        onClick={() => void store.managed({ action: "checkout", packId: pack.id })}>
        {t("agent.compute.topUp", { amount: money(pack.price_cents * 10_000) })}
      </button>)}
      <button type="button" className="desktop-settings-action" disabled={pending}
        onClick={() => void store.managed({ action: "refresh" })}>{t("agent.compute.refreshBalance")}</button>
    </>} />;
}

/**
 * Personal billing stays available independently of experimental Cloud hosting.
 *
 * `payments` arrives from the Settings render entry, never from the stored
 * experiment: see `src/features/payments/README.md`. Without it this surface is
 * account sign-in and nothing else, and it issues no wallet read, so the
 * one-time trial credit is never claimed either.
 */
export function AccountAICredits({ payments, signedIn, onSignIn, signInDisabled = false }: {
  payments: boolean;
  signedIn: boolean;
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
  // would still draw a separator under the account.
  if (!payments && signedIn) return null;

  return <SettingsSubsection>
    {showAccount ? <WalletRow credit={credit} pending={state.pending.managed} store={store} />
    : !signedIn ? <>
      <div className="desktop-settings-row desktop-settings-row-control">
        <span>{t("settings.account.authentication")}</span>
        <div className="desktop-settings-value desktop-settings-account-actions">
          <button type="button" className="desktop-settings-action primary" disabled={signInDisabled || (!onSignIn && state.pending.managed)}
            onClick={() => onSignIn ? onSignIn() : void store.managed({ action: "sign-in" })}>
            {t("cloud.auth.signIn")}
          </button>
        </div>
      </div>
    </> : null}
    {((showAccount && (state.error || credit?.errorCode)) || state.error === "AUTHENTICATION_FAILED") &&
      <div className="desktop-settings-account-feedback danger" role="alert">{operationError}</div>}
  </SettingsSubsection>;
}
