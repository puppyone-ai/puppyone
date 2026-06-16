import { getApiAccessToken } from './apiClient';

export type BillingPlanId = 'free' | 'plus' | 'pro';
export type PaidBillingPlanId = Exclude<BillingPlanId, 'free'>;

export type PaymentActionResponse = {
  ok: boolean;
  mode?: 'checkout' | 'direct' | 'price_update' | 'cancel_at_period_end';
  checkout_url?: string;
  target?: string;
  org_id?: string;
  sync_pending?: boolean;
  message?: string;
};

function paymentsApiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_PAYMENTS_API_URL?.trim();
  if (!raw) {
    throw new Error('NEXT_PUBLIC_PAYMENTS_API_URL is not configured.');
  }
  return raw.replace(/\/+$/, '');
}

export function isPaymentsConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_PAYMENTS_API_URL?.trim());
}

async function parsePaymentResponse(response: Response): Promise<PaymentActionResponse> {
  const text = await response.text();
  if (!text) return { ok: response.ok };
  try {
    return JSON.parse(text) as PaymentActionResponse;
  } catch {
    return { ok: response.ok, message: text };
  }
}

async function paymentRequest(
  endpoint: '/api/polar/upgrade' | '/api/polar/downgrade',
  body: { target: BillingPlanId; org_id: string },
): Promise<PaymentActionResponse> {
  const token = await getApiAccessToken();
  if (!token) {
    throw new Error('You are not signed in, or your session has expired.');
  }

  const response = await fetch(`${paymentsApiBaseUrl()}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  const payload = await parsePaymentResponse(response);
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || `Payment request failed with HTTP ${response.status}.`);
  }
  return payload;
}

export function upgradePlan(target: PaidBillingPlanId, orgId: string): Promise<PaymentActionResponse> {
  return paymentRequest('/api/polar/upgrade', { target, org_id: orgId });
}

export function downgradePlan(target: BillingPlanId, orgId: string): Promise<PaymentActionResponse> {
  return paymentRequest('/api/polar/downgrade', { target, org_id: orgId });
}
