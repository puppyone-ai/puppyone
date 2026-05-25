/**
 * Route-segment loading fallback for /home (the project dashboard).
 *
 * Used by Next.js App Router as the Suspense fallback while the
 * /home route's JS bundle + first paint resolve. The AppSidebar
 * stays mounted (it lives in the parent (main) layout), and only the
 * inner content area shows this loader.
 */
import { PageLoading } from '@/components/loading';

export default function HomeLoading() {
  return <PageLoading variant="fill" />;
}
