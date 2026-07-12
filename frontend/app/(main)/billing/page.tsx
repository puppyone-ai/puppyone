'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowUpRight, Check, CreditCard, ExternalLink, Mail, RefreshCw, X } from 'lucide-react';
import { useOrganization } from '@/contexts/OrganizationContext';
import { OrganizationPageShell } from '@/components/organization/OrganizationPageShell';
import { ActionButton } from '@/components/ui/ActionButton';
import { Dots, PageLoading, SkeletonBlock } from '@/components/loading';
import {
  getOrganizationEntitlements,
  type OrganizationEntitlements,
} from '@/lib/organizationsApi';
import {
  downgradePlan,
  isPaymentsConfigured,
  upgradePlan,
  type BillingPlanId,
} from '@/lib/paymentsApi';

type Feedback = {
  type: 'error' | 'success' | 'info';
  msg: string;
};

type PlanItem = {
  type: 'metric' | 'capability';
  value?: string;
  label: string;
  included?: boolean;
};

type DisplayPlanId = BillingPlanId | 'enterprise';

type PlanDefinition = {
  id: DisplayPlanId;
  name: string;
  price: string;
  cadence?: string;
  line: string;
  badge?: string;
  items: PlanItem[];
};

const PLAN_ORDER: Record<BillingPlanId, number> = {
  free: 0,
  plus: 1,
  pro: 2,
};

const PLANS: PlanDefinition[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    cadence: '/ month',
    line: 'Basic access for one project.',
    items: [
      { type: 'metric', value: '1', label: 'seat' },
      { type: 'metric', value: '1', label: 'project' },
      { type: 'metric', value: '2', label: 'scopes/project' },
      { type: 'metric', value: '1 GB', label: 'storage' },
      { type: 'metric', value: '1 GB', label: 'storage/project' },
      { type: 'metric', value: '2,000', label: 'files/project' },
      { type: 'metric', value: '50 MB', label: 'single file upload' },
      { type: 'capability', label: 'Git Remote' },
      { type: 'capability', label: 'CLI' },
      { type: 'capability', label: 'MCP', included: false },
      { type: 'capability', label: 'Workspace', included: false },
      { type: 'capability', label: 'Sandbox', included: false },
      { type: 'capability', label: 'Enterprise deployment', included: false },
    ],
  },
  {
    id: 'plus',
    name: 'Plus',
    price: '$15',
    cadence: '/ month',
    line: 'For small teams.',
    badge: 'Recommended',
    items: [
      { type: 'metric', value: '10', label: 'seats' },
      { type: 'metric', value: '5', label: 'projects' },
      { type: 'metric', value: '10', label: 'scopes/project' },
      { type: 'metric', value: '50 GB', label: 'storage' },
      { type: 'metric', value: '10 GB', label: 'storage/project' },
      { type: 'metric', value: '25,000', label: 'files/project' },
      { type: 'metric', value: '200 MB', label: 'single file upload' },
      { type: 'capability', label: 'Git Remote' },
      { type: 'capability', label: 'CLI' },
      { type: 'capability', label: 'MCP' },
      { type: 'capability', label: 'Workspace', included: false },
      { type: 'capability', label: 'Sandbox', included: false },
      { type: 'capability', label: 'Enterprise deployment', included: false },
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$100',
    cadence: '/ month',
    line: 'For larger teams.',
    items: [
      { type: 'metric', value: '50', label: 'seats' },
      { type: 'metric', value: '50', label: 'projects' },
      { type: 'metric', value: 'Unlimited', label: 'scopes' },
      { type: 'metric', value: '500 GB', label: 'storage' },
      { type: 'metric', value: '50 GB', label: 'storage/project' },
      { type: 'metric', value: '250,000', label: 'files/project' },
      { type: 'metric', value: '500 MB', label: 'single file upload' },
      { type: 'capability', label: 'Git Remote' },
      { type: 'capability', label: 'CLI' },
      { type: 'capability', label: 'MCP' },
      { type: 'capability', label: 'Workspace' },
      { type: 'capability', label: 'Sandbox' },
      { type: 'capability', label: 'Enterprise deployment', included: false },
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    line: 'For private deployments.',
    items: [
      { type: 'metric', value: 'Custom', label: 'seats' },
      { type: 'metric', value: 'Custom', label: 'projects' },
      { type: 'metric', value: 'Custom', label: 'scopes' },
      { type: 'metric', value: 'Custom', label: 'storage' },
      { type: 'metric', value: 'Custom', label: 'storage/project' },
      { type: 'metric', value: 'Custom', label: 'files/project' },
      { type: 'metric', value: 'Custom', label: 'single file upload' },
      { type: 'capability', label: 'Git Remote' },
      { type: 'capability', label: 'CLI' },
      { type: 'capability', label: 'MCP' },
      { type: 'capability', label: 'Workspace' },
      { type: 'capability', label: 'Sandbox' },
      { type: 'capability', label: 'Enterprise deployment' },
    ],
  },
];

const UPGRADE_PLANS = PLANS.filter(plan => plan.id !== 'free');
const CURRENT_SUMMARY_LABELS = new Set([
  'seat',
  'seats',
  'project',
  'projects',
  'scopes/project',
  'scopes',
  'storage',
  'storage/project',
  'single file upload',
  'Git Remote',
  'CLI',
  'MCP',
  'Workspace',
  'Sandbox',
]);
const UPGRADE_DETAIL_LABELS = new Set([
  'seats',
  'projects',
  'scopes/project',
  'scopes',
  'storage',
  'storage/project',
  'files/project',
  'single file upload',
  'MCP',
  'Workspace',
  'Sandbox',
  'Enterprise deployment',
]);

function normalizeDisplayPlanId(value: unknown): DisplayPlanId {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'enterprise') return 'enterprise';
  return raw === 'plus' || raw === 'pro' ? raw : 'free';
}

function normalizePlanId(value: unknown): BillingPlanId {
  const raw = normalizeDisplayPlanId(value);
  if (raw === 'enterprise') return 'pro';
  return raw === 'plus' || raw === 'pro' ? raw : 'free';
}

function titleCasePlan(planId: string): string {
  const normalized = normalizeDisplayPlanId(planId);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getPlanById(id: DisplayPlanId): PlanDefinition {
  return PLANS.find(plan => plan.id === id) ?? PLANS[0];
}

function formatPlanItem(item: PlanItem): string {
  return item.value ? `${item.value} ${item.label}` : item.label;
}

function getFeedbackStyle(type: Feedback['type']) {
  if (type === 'error') {
    return {
      borderColor: 'color-mix(in srgb, var(--po-danger) 28%, transparent)',
      background: 'color-mix(in srgb, var(--po-danger) 8%, transparent)',
      color: 'var(--po-danger)',
    };
  }
  if (type === 'success') {
    return {
      borderColor: 'color-mix(in srgb, var(--po-success) 28%, transparent)',
      background: 'color-mix(in srgb, var(--po-success) 8%, transparent)',
      color: 'var(--po-success)',
    };
  }
  return {
    borderColor: 'color-mix(in srgb, var(--po-accent) 28%, transparent)',
    background: 'color-mix(in srgb, var(--po-accent) 8%, transparent)',
    color: 'var(--po-accent)',
  };
}

function BillingSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <SkeletonBlock height={138} radius={8} />
      <div className="grid gap-4 lg:grid-cols-3">
        <SkeletonBlock height={420} radius={8} />
        <SkeletonBlock height={420} radius={8} />
        <SkeletonBlock height={420} radius={8} />
      </div>
    </div>
  );
}

export default function BillingPage() {
  const searchParams = useSearchParams();
  const checkoutReturned = searchParams.get('success') === '1';
  const {
    orgs,
    currentOrg,
    myRole,
    isLoading: isOrgsLoading,
    error: orgsError,
    refreshOrgs,
  } = useOrganization();

  const [snapshot, setSnapshot] = useState<OrganizationEntitlements | null>(null);
  const [entitlementsLoading, setEntitlementsLoading] = useState(false);
  const [changingPlan, setChangingPlan] = useState<BillingPlanId | null>(null);
  const [polling, setPolling] = useState(false);
  const [handledReturn, setHandledReturn] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const paymentsConfigured = isPaymentsConfigured();
  const isOwner = myRole === 'owner';
  const currentDisplayPlan = normalizeDisplayPlanId(snapshot?.plan_id || currentOrg?.plan);
  const currentPlan = normalizePlanId(currentDisplayPlan);
  const currentPlanDefinition = getPlanById(currentDisplayPlan);
  const currentSummaryItems = currentPlanDefinition.items.filter(item => CURRENT_SUMMARY_LABELS.has(item.label));

  const refreshEntitlements = useCallback(async () => {
    if (!currentOrg) return;
    setEntitlementsLoading(true);
    try {
      const data = await getOrganizationEntitlements(currentOrg.id);
      setSnapshot(data);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to load billing status.';
      setFeedback({ type: 'error', msg });
    } finally {
      setEntitlementsLoading(false);
    }
  }, [currentOrg]);

  useEffect(() => {
    setSnapshot(null);
    void refreshEntitlements();
  }, [refreshEntitlements]);

  useEffect(() => {
    if (!checkoutReturned || handledReturn) return;
    setHandledReturn(true);
    setPolling(true);
    setFeedback({
      type: 'info',
      msg: 'Payment returned from Polar. Your plan will update after billing sync completes.',
    });
  }, [checkoutReturned, handledReturn]);

  useEffect(() => {
    if (!polling || !currentOrg) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      void refreshEntitlements();
      if (attempts >= 15) {
        window.clearInterval(timer);
        setPolling(false);
      }
    }, 2000);
    void refreshEntitlements();
    return () => window.clearInterval(timer);
  }, [currentOrg, polling, refreshEntitlements]);

  const handlePlanChange = useCallback(
    async (target: BillingPlanId) => {
      if (!currentOrg || target === currentPlan || currentDisplayPlan === 'enterprise') return;
      if (!paymentsConfigured) {
        setFeedback({ type: 'error', msg: 'Checkout is unavailable in this environment.' });
        return;
      }
      if (!isOwner) {
        setFeedback({ type: 'error', msg: 'Only an organization owner can manage billing.' });
        return;
      }

      setChangingPlan(target);
      setFeedback(null);
      try {
        const currentRank = PLAN_ORDER[currentPlan];
        const targetRank = PLAN_ORDER[target];
        const payload = targetRank > currentRank
          ? await upgradePlan(target as Exclude<BillingPlanId, 'free'>, currentOrg.id)
          : await downgradePlan(target, currentOrg.id);

        if (payload.checkout_url) {
          window.location.href = payload.checkout_url;
          return;
        }

        setPolling(Boolean(payload.sync_pending || payload.mode));
        setFeedback({
          type: 'success',
          msg: payload.mode === 'cancel_at_period_end'
            ? 'Cancellation was sent. This page will update after billing sync completes.'
            : 'Plan change was sent. This page will update after billing sync completes.',
        });
        await Promise.all([refreshEntitlements(), refreshOrgs()]);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Payment request failed.';
        setFeedback({ type: 'error', msg });
      } finally {
        setChangingPlan(null);
      }
    },
    [
      currentOrg,
      currentDisplayPlan,
      currentPlan,
      isOwner,
      paymentsConfigured,
      refreshEntitlements,
      refreshOrgs,
    ],
  );

  if (!currentOrg) {
    if (orgsError) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="text-[14px] font-medium text-[var(--po-text)]">
            {"Couldn't load your organizations"}
          </div>
          <div className="max-w-md text-[13px] text-[var(--po-text-subtle)]">
            {orgsError.message || 'The request failed. Your session may have expired.'}
          </div>
          <ActionButton
            variant="primary"
            leadingIcon={<RefreshCw size={14} strokeWidth={2} />}
            onClick={() => { void refreshOrgs(); }}
          >
            Retry
          </ActionButton>
        </div>
      );
    }
    if (isOrgsLoading || orgs.length > 0) {
      return (
        <div className="flex-1">
          <PageLoading variant="fill" />
        </div>
      );
    }
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="text-[14px] font-medium text-[var(--po-text)]">No organization yet</div>
        <div className="max-w-md text-[13px] text-[var(--po-text-subtle)]">
          You need an organization before billing can be managed.
        </div>
      </div>
    );
  }

  return (
    <OrganizationPageShell
      title="Billing"
      description={`Manage the plan for ${currentOrg.name}.`}
      actions={
        <ActionButton
          variant="secondary"
          leadingIcon={polling || entitlementsLoading ? <Dots size="xs" /> : <RefreshCw size={14} strokeWidth={2} />}
          onClick={() => { void refreshEntitlements(); }}
          disabled={entitlementsLoading}
        >
          Refresh
        </ActionButton>
      }
    >
      {feedback && (
        <div
          className="mb-5 rounded-[8px] border px-4 py-3 text-[13px] font-medium"
          style={getFeedbackStyle(feedback.type)}
        >
          {feedback.msg}
        </div>
      )}

      {!isOwner && (
        <div className="mb-5 rounded-[8px] border border-[var(--po-border)] bg-[var(--po-panel)] px-4 py-3 text-[13px] text-[var(--po-text-muted)]">
          Organization owner role is required for billing changes.
        </div>
      )}

      {entitlementsLoading && !snapshot ? (
        <BillingSkeleton />
      ) : (
        <div className="flex flex-col gap-5">
          <section className="rounded-[8px] border border-[var(--po-border)] bg-[var(--po-panel)] shadow-[0_1px_0_rgba(73,55,35,0.04)]">
            <div className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex h-6 items-center rounded-[5px] border border-[var(--po-border-subtle)] bg-[var(--po-control)] px-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--po-text-muted)]">
                    Current plan
                  </span>
                  <h2 className="text-[17px] font-semibold text-[var(--po-text)]">
                    {titleCasePlan(currentDisplayPlan)}
                  </h2>
                  {polling && (
                    <span className="inline-flex h-6 items-center gap-1.5 rounded-[5px] border border-[color-mix(in_srgb,var(--po-success)_28%,transparent)] px-2 text-[11px] font-medium text-[var(--po-success)]">
                      <Dots size="xs" tone="success" />
                      Syncing
                    </span>
                  )}
                </div>
                <p className="mt-2 max-w-2xl text-[13px] leading-5 text-[var(--po-text-muted)]">
                  {currentPlanDefinition.line}
                </p>
              </div>
              <div className="shrink-0 text-left lg:text-right">
                <div className="text-[28px] font-semibold leading-none tracking-tight text-[var(--po-text)]">
                  {currentPlanDefinition.price}
                  {currentPlanDefinition.cadence && (
                    <span className="ml-1 text-[12px] font-medium tracking-normal text-[var(--po-text-subtle)]">
                      {currentPlanDefinition.cadence}
                    </span>
                  )}
                </div>
                <div className="mt-2 text-[12px] text-[var(--po-text-subtle)]">Managed through Polar</div>
              </div>
            </div>
            <div className="border-t border-[var(--po-border-subtle)] px-5 py-3">
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {currentSummaryItems.map(item => {
                  const included = item.included !== false;
                  return (
                    <span
                      key={`current-${item.type}-${item.value || 'included'}-${item.label}`}
                      className={[
                        'inline-flex items-center gap-1.5 text-[12px] leading-5',
                        included ? 'text-[var(--po-text)]' : 'text-[var(--po-text-disabled)]',
                      ].join(' ')}
                    >
                      <span className={`shrink-0 ${included ? 'text-[var(--po-success)]' : 'text-[var(--po-text-disabled)]'}`}>
                        {included ? <Check size={13} strokeWidth={2.4} /> : <X size={13} strokeWidth={2.2} />}
                      </span>
                      <span>{formatPlanItem(item)}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-[15px] font-semibold text-[var(--po-text)]">Upgrade options</h2>
                <p className="mt-1 text-[12px] leading-5 text-[var(--po-text-subtle)]">
                  Pick Plus for MCP, Pro for hosted workspace, or Enterprise for private deployment.
                </p>
              </div>
              <div className="text-[12px] text-[var(--po-text-subtle)]">Checkout through Polar</div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              {UPGRADE_PLANS.map(plan => {
                const isEnterprise = plan.id === 'enterprise';
                const isCurrent = plan.id === currentDisplayPlan;
                const isRecommended = Boolean(plan.badge && !isCurrent);
                const target: BillingPlanId | null = isEnterprise ? null : (plan.id as BillingPlanId);
                const targetRank = target ? PLAN_ORDER[target] : null;
                const currentRank = PLAN_ORDER[currentPlan];
                const isDowngrade = targetRank !== null && targetRank < currentRank;
                const isChanging = target ? changingPlan === target : false;
                const detailItems = plan.items.filter(item => UPGRADE_DETAIL_LABELS.has(item.label));
                const disabled = isCurrent
                  ? true
                  : isEnterprise
                    ? false
                    : currentDisplayPlan === 'enterprise' || !isOwner || Boolean(changingPlan);
                const actionLabel = isCurrent
                  ? 'Current plan'
                  : isEnterprise
                    ? 'Contact us'
                    : currentDisplayPlan === 'enterprise'
                      ? 'Contact support'
                      : isChanging
                        ? 'Working'
                        : targetRank !== null && targetRank > currentRank
                          ? `Choose ${plan.name}`
                          : `Switch to ${plan.name}`;
                const actionVariant = isCurrent || isEnterprise
                  ? 'secondary'
                  : isDowngrade
                    ? 'warning'
                    : plan.id === 'plus'
                      ? 'primary'
                      : 'secondary';

                return (
                <article
                  key={plan.id}
                  className={[
                    'flex min-h-[430px] flex-col rounded-[8px] border bg-[var(--po-panel)] p-5 shadow-[0_1px_0_rgba(73,55,35,0.04)] transition-colors duration-150',
                    plan.id === 'plus' && !isCurrent
                      ? 'border-[var(--po-border-strong)]'
                      : 'border-[var(--po-border)]',
                  ].join(' ')}
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[18px] font-semibold text-[var(--po-text)]">{plan.name}</h3>
                      {isCurrent && (
                        <span className="inline-flex h-6 items-center rounded-[5px] border border-[var(--po-border-subtle)] bg-[var(--po-control)] px-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--po-text-muted)]">
                          Current
                        </span>
                      )}
                      {isRecommended && (
                        <span className="inline-flex h-6 items-center rounded-[5px] border border-[var(--po-border-subtle)] bg-[var(--po-control)] px-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--po-text-muted)]">
                          {plan.badge}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[13px] leading-5 text-[var(--po-text-muted)]">
                      {plan.line}
                    </p>
                  </div>

                  <div className="mt-5">
                    <span className="text-[34px] font-semibold leading-none tracking-tight text-[var(--po-text)]">
                      {plan.price}
                    </span>
                    {plan.cadence && (
                      <span className="ml-1 text-[12px] font-medium text-[var(--po-text-subtle)]">
                        {plan.cadence}
                      </span>
                    )}
                  </div>

                  <div className="mt-5 space-y-2.5 border-t border-[var(--po-border-subtle)] pt-4">
                    {detailItems.map(item => {
                      const included = item.included !== false;
                      return (
                        <div
                          key={`${plan.id}-${item.type}-${item.value || 'included'}-${item.label}`}
                          className={[
                            'flex items-center gap-2 text-[12px] leading-5',
                            included ? 'text-[var(--po-text)]' : 'text-[var(--po-text-disabled)]',
                          ].join(' ')}
                        >
                          <span className={`shrink-0 ${included ? 'text-[var(--po-success)]' : 'text-[var(--po-text-disabled)]'}`}>
                            {included ? (
                              <Check size={14} strokeWidth={2.4} />
                            ) : (
                              <X size={14} strokeWidth={2.2} />
                            )}
                          </span>
                          <span>
                            {item.value && (
                              <strong
                                className={included ? 'font-semibold text-[var(--po-text)]' : 'font-semibold text-[var(--po-text-disabled)]'}
                              >
                                {item.value}
                              </strong>
                            )}
                            <span className={item.value ? 'ml-1' : ''}>
                              {item.label}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-auto pt-5">
                    <ActionButton
                      fullWidth
                      variant={actionVariant}
                      loading={isChanging}
                      disabled={disabled}
                      leadingIcon={
                        isEnterprise
                          ? <Mail size={14} strokeWidth={2} />
                          : isCurrent
                            ? <Check size={14} strokeWidth={2.2} />
                            : <CreditCard size={14} strokeWidth={2} />
                      }
                      trailingIcon={!isCurrent && !isChanging && !isDowngrade ? <ExternalLink size={13} strokeWidth={2} /> : null}
                      onClick={() => {
                        if (isEnterprise) {
                          window.location.href = 'mailto:sales@puppyagent.com?subject=PuppyOne%20Enterprise';
                          return;
                        }
                        if (target) {
                          void handlePlanChange(target);
                        }
                      }}
                    >
                      {actionLabel}
                    </ActionButton>
                  </div>
                </article>
              );
            })}
            </div>
          </section>

          <div className="flex items-center justify-between gap-3 rounded-[8px] border border-[var(--po-border-subtle)] bg-[color-mix(in_srgb,var(--po-panel)_55%,transparent)] px-4 py-3 text-[12px] text-[var(--po-text-subtle)]">
            <span>
              {paymentsConfigured
                ? 'Checkout is handled by Polar.'
                : 'Checkout is unavailable in this environment.'}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[var(--po-text-muted)]">
              {paymentsConfigured ? 'Secure billing' : 'Billing service offline'}
              <ArrowUpRight size={12} strokeWidth={2.2} />
            </span>
          </div>
        </div>
      )}
    </OrganizationPageShell>
  );
}
