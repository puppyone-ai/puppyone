import { useDesktopPreference } from "../../preferencesStore";

/**
 * The single decision point for asking anyone for money.
 *
 * `true` is the default and offers what the product sells: the machines on
 * Account, PuppyOne's own token, the account balance it spends, the one-time
 * trial credit, and the top-up that refills it. `false` is the opt-out, and
 * then the Desktop never presents a price, a balance or a payment: the Agent
 * routes only to the user's own API keys and local models.
 *
 * Render entries read this hook and pass the decision down as `payments`. Leaf
 * components never read the stored experiment, so one install can never show a
 * paid surface while another part of the same window hides it.
 */
export function usePaymentsExperience(): boolean {
  return useDesktopPreference((state) => state.experimentalSettings.enablePayments);
}
