# Payments

Paid compute is an experiment. `enablePayments` is off by default, so an
untouched Desktop install never shows a price, a balance, a trial credit or a
top-up, and the Agent routes only to the user's own API keys and local models.

Paid compute needs a PuppyOne account, so it rides on Cloud:
`usePaymentsExperience()` is true only while Cloud is on (`useCloudEnabled()` in
`src/features/flags`)
*and* `enablePayments` is on. With Cloud off, the Payments switch is not
offered and a stored `true` has no effect.

## Fork convention

- `enablePayments` is named in exactly three files: `src/preferences.ts` (the
  stored default and its restore), `src/features/settings/main/ExperimentalSettingsView.tsx`
  (the switch) and `usePaymentsExperience.ts` (the read).
- Render entries decide, leaves obey. `AgentChatTabPanel` and
  `AccountSettingsView` call `usePaymentsExperience()` and pass the result down
  as the required `payments` prop. `BuiltInAgentCompute` and `AccountAICredits`
  take that prop and never read the experiment themselves, so the Agent dock
  and Settings can never disagree about whether this install may be charged.
- The prop is required on purpose. A new payment surface cannot be added
  without stating which side of the fork it belongs to.

## What the switch owns

| Surface | On | Off |
| --- | --- | --- |
| Agent compute summary | PuppyOne's token, with the account balance behind it | the user's own API and local models only |
| Agent send attempt without a route | sign-in, the one-time trial credit, or `Add credit to use this model.` | points at the user's own connection |
| Settings → Account (shown only with Cloud on) | available balance, top-up and refresh | account sign-in only |
| Wallet reads and the trial claim | polled while signed in | never requested |

Off is not only a hidden surface: with the experiment off the renderer issues
no `managed` wallet read, so the main process never claims the one-time trial
credit and no balance exists to spend. Checkout can only start from a surface
this switch controls.

## Retirement

Retiring the experiment means deleting the switch, the flag and this hook, and
keeping the paid path unconditional. Until the paid path is the product, the
`payments` prop stays required so every surface keeps declaring its side.
