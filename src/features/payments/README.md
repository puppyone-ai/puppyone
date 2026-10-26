# Payments

Asking for money is part of the product, so `enablePayments` is on by default:
**Account** states who you are, what you run and what it costs you a month,
**Billing** is where every price lives and every charge begins, and the Agent
may spend PuppyOne's own token. The switch
survives as an opt-out — turn it off and the Desktop shows no price, balance,
trial credit or top-up anywhere, and the Agent routes only to the user's own
API keys and local models.

Paid compute needs a PuppyOne account, so it rides on Cloud:
`usePaymentsExperience()` is true only while Cloud is on (`useCloudEnabled()` in
`src/features/flags`)
*and* `enablePayments` is on. With Cloud off, the Payments switch is not
offered and a stored `true` has no effect.

## Fork convention

- `enablePayments` is named in exactly three files: `src/preferences.ts` (the
  stored default and its restore), `src/features/settings/main/ExperimentalSettingsView.tsx`
  (the switch) and `usePaymentsExperience.ts` (the read).
- Render entries decide, leaves obey. `AgentChatTabPanel`,
  `AccountSettingsView` and `BillingSettingsView` call `usePaymentsExperience()`
  and pass the result down as the required `payments` prop. `BuiltInAgentCompute`
  and `AccountAICredits` take that prop, and `CloudAgentPurchase` is only mounted
  inside the fork, so no payment surface reads the experiment for itself and the
  Agent dock and Settings can never disagree about whether this install may be
  charged.
- The prop is required on purpose. A new payment surface cannot be added
  without stating which side of the fork it belongs to.

## What the switch owns

| Surface | On (default) | Off |
| --- | --- | --- |
| Settings nav | `Billing` under Cloud | no such page, and the section is not routable |
| Settings → Account | what the account runs, what it costs a month, usage meters and the available balance | identity and sign-in only |
| Settings → Billing | the machines and their prices, the purchase, top-up and refresh | nothing: the page renders null |
| Agent compute summary | PuppyOne's token, with the account balance behind it | the user's own API and local models only |
| Agent send attempt without a route | sign-in, the one-time trial credit, or `Add credit to use this model.` | points at the user's own connection |
| Settings → Account (shown only with Cloud on) | available balance, top-up and refresh | account sign-in only |
| Wallet, catalog and usage reads | polled while signed in | never requested |

Off is not only a hidden surface: with the experiment off the renderer issues
no `managed` wallet read and no billing read, so the main process never claims
the one-time trial credit and no balance exists to spend. Checkout can only
start from a surface this switch controls.

## Reaching the price

Settings opens on Account, the first row of the first group, and `Billing` is
the row directly beneath it. Both resolve with no project open and with no
session, because what a cloud workspace costs must be answerable before anyone
signs in.

The line between them is **state and purchase**: Account reports what is true
and changes nothing, Billing holds every price and every charge. It is not the
line that was here before. `Account / Plan & Usage` split the same question in
two — both pages stated how many machines the account held, so each ended in a
link to the other and neither was the answer. Under the current line, Account
states one figure and offers one way to change it, and no catalogue price
appears anywhere outside Billing.

Invoices, payment methods and tax details land on Billing when they arrive;
they do not need a third page.

## Retirement

Retiring the experiment means deleting the switch, the flag and this hook, and
keeping the paid path unconditional. Until then the `payments` prop stays
required so every surface keeps declaring its side.
