import { useEffect } from "react";
import { useLocalization } from "@puppyone/localization";
import { useModelConnections, type ModelConnectionStore } from "../../model-connections";
import { SettingsSubsection, SettingsValueRow } from "../components";

/** Personal billing stays available independently of experimental Cloud hosting. */
export function AccountAICredits({ store: providedStore, signedIn, onSignIn, signInDisabled = false }: {
  store?: ModelConnectionStore;
  signedIn: boolean;
  onSignIn?: () => void;
  signInDisabled?: boolean;
}) {
  const { t } = useLocalization();
  const { state, store } = useModelConnections(providedStore);
  const credit = state.snapshot?.managed;
  const showAccount = signedIn && credit?.signedIn;
  const operationError = state.error === "AUTHENTICATION_FAILED"
    ? t("agent.compute.signInUnavailable")
    : t("agent.compute.paymentUnavailable");
  const money = (micro: number) => new Intl.NumberFormat(undefined, {
    style: "currency", currency: "USD", maximumFractionDigits: 6,
  }).format(micro / 1_000_000);

  useEffect(() => {
    const refresh = () => { if (!document.hidden) void store.managed({ action: "refresh" }); };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [store]);

  return <SettingsSubsection>
    {showAccount ?
      <SettingsValueRow label={t("agent.compute.availableBalance")}
        value={credit.reason === "gateway-unavailable" || credit.reason === "loading" ? "—" : money(credit.availableMicroUsd ?? 0)}
        action={<>
          {(credit.packs ?? []).map((pack) => <button key={pack.id} type="button"
            className="desktop-settings-action primary" disabled={state.pending.managed}
            onClick={() => void store.managed({ action: "checkout", packId: pack.id })}>
            {t("agent.compute.topUp", { amount: money(pack.price_cents * 10_000) })}
          </button>)}
          <button type="button" className="desktop-settings-action" disabled={state.pending.managed}
            onClick={() => void store.managed({ action: "refresh" })}>{t("agent.compute.refreshBalance")}</button>
        </>} />
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
