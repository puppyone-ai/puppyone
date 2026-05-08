/**
 * Route-segment loading fallback for /settings (and /settings/connect).
 *
 * Suspense fallback shown while the settings JS bundle resolves.
 * The AppSidebar (parent (main) layout) and the settings layout
 * (this segment's `layout.tsx`) both stay mounted; only the inner
 * content area shows this loader.
 */
import { PageLoading } from '@/components/loading';

export default function SettingsLoading() {
  return <PageLoading variant="fill" />;
}
