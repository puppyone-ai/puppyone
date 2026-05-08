/**
 * Route-segment loading fallback for /team.
 *
 * Suspense fallback shown while the team management JS bundle + the
 * org-membership data resolve. The AppSidebar stays mounted; only
 * the content area shows this loader.
 */
import { PageLoading } from '@/components/loading';

export default function TeamLoading() {
  return <PageLoading variant="fill" />;
}
