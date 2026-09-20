import { useEffect } from "react";
import { useLocalization } from "@puppyone/localization";
import { useModelConnections, type ModelConnectionStore } from "../../model-connections";
import { SettingsSectionHeader, SettingsSubsection, SettingsValueRow } from "../components";

/** Personal billing stays available independently of experimental Cloud hosting. */
export function AccountAICredits({ store: providedStore }: { store?: ModelConnectionStore }) {
  const { t } = useLocalization();
  const { state, store } = useModelConnections(providedStore);
  const credit = state.snapshot?.managed;
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

  return <div className="desktop-settings-section">
    <SettingsSectionHeader title={t("agent.compute.walletTitle")} detail={t("agent.compute.walletDetail")} />
    <SettingsSubsection>
      <SettingsValueRow label={t("agent.compute.walletTitle")} value={money(credit?.availableMicroUsd ?? 0)} />
      {(credit?.trialGrantedMicroUsd ?? 0) > 0 && <p>{t("agent.compute.trialGranted", { amount: money(credit?.trialGrantedMicroUsd ?? 0) })}</p>}
      {(credit?.reservedMicroUsd ?? 0) > 0 && <p>{t("agent.compute.pendingCredit", { amount: money(credit?.reservedMicroUsd ?? 0) })}</p>}
      {credit?.sandbox && <p>{t("agent.compute.sandbox")}</p>}
      <div className="desktop-settings-row desktop-settings-row-control">
        <div className="desktop-settings-value desktop-settings-account-actions">
          {(credit?.packs ?? []).map((pack) => <button key={pack.id} type="button"
            className="desktop-settings-action primary" disabled={!credit?.signedIn || state.pending.managed}
            onClick={() => void store.managed({ action: "checkout", packId: pack.id })}>
            {t("agent.compute.topUp", { amount: money(pack.price_cents * 10_000) })}
          </button>)}
          <button type="button" className="desktop-settings-action" disabled={state.pending.managed}
            onClick={() => void store.managed({ action: "refresh" })}>{t("agent.compute.refreshBalance")}</button>
        </div>
      </div>
      {(state.error || credit?.errorCode) && <p role="alert">{t("agent.compute.paymentUnavailable")}</p>}
    </SettingsSubsection>
    {credit?.lastUsage && <SettingsSubsection>
      <SettingsValueRow label={t("agent.compute.latestUsage")} value={credit.lastUsage.modelId} />
      <SettingsValueRow label={t("agent.compute.usageCharge")} value={credit.lastUsage.status === "settled"
        ? money(credit.lastUsage.chargedMicroUsd ?? 0)
        : t(credit.lastUsage.status === "released" ? "agent.compute.usageReleased" : "agent.compute.usagePending")} />
      {credit.lastUsage.status === "settled" && <p>{t("agent.compute.usageTokens", {
        input: credit.lastUsage.inputTokens ?? 0, cached: credit.lastUsage.cachedTokens ?? 0,
        output: credit.lastUsage.outputTokens ?? 0,
      })}</p>}
    </SettingsSubsection>}
    {(credit?.modelPrices?.length ?? 0) > 0 && <SettingsSubsection>
      <p>{t("agent.compute.modelPrices")}</p>
      {credit?.modelPrices?.map((model) => <SettingsValueRow key={model.modelId} label={model.name}
        value={t("agent.compute.modelRates", { input: money(model.inputMicroUsdPerMillion),
          cached: money(model.cachedMicroUsdPerMillion), output: money(model.outputMicroUsdPerMillion) })} />)}
    </SettingsSubsection>}
  </div>;
}
