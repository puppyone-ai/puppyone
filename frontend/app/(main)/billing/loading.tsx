/**
 * Route-segment loading fallback for /billing.
 *
 * Suspense fallback shown while the billing JS bundle + Stripe data
 * resolve. The AppSidebar stays mounted; only the content area
 * shows this loader.
 */
import { PageLoading } from '@/components/loading';

export default function BillingLoading() {
  return <PageLoading variant="fill" />;
}
