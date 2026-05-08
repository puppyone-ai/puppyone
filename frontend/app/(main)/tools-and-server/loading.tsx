/**
 * Route-segment loading fallback for /tools-and-server.
 *
 * Suspense fallback shown while the tools/server JS bundle + first
 * paint resolve. The AppSidebar (in the parent (main) layout) and
 * the tools/server tab strip (in tools-and-server/layout) both stay
 * mounted; only the content area shows this loader.
 */
import { PageLoading } from '@/components/loading';

export default function ToolsAndServerLoading() {
  return <PageLoading variant="fill" />;
}
