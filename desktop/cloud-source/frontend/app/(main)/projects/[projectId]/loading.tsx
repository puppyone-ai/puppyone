/**
 * Route-segment loading fallback for every project sub-route.
 *
 * Next.js App Router automatically wraps the [projectId] segment's
 * `children` in `<Suspense fallback={<Loading />}>`. This means the
 * MOMENT a user clicks "Access" / "History" / "Settings" / etc. in
 * the sidebar:
 *
 *   1. The URL flips to the new route immediately.
 *   2. The (main)/layout AppSidebar AND the [projectId]/layout
 *      providers stay mounted — no flicker on the chrome.
 *   3. THIS component renders inside the `<main>` content area while
 *      Next.js loads the new page module + the page's first paint
 *      finishes.
 *   4. As soon as the destination page renders, this fallback is
 *      replaced — invisibly, with no layout shift.
 *
 * Without this file, Next.js would block on the new route's JS chunk
 * + first render before changing the URL, giving the impression that
 * the click "didn't work" for ~half a second.
 *
 * The page itself still owns its OWN loading state for data fetched
 * AFTER the page mounts (SWR / useEffect). That second loading layer
 * usually shows a skeleton matching the page's eventual layout.
 */
import { ProjectPageLoadingShell } from '@/components/loading';

export default function ProjectSegmentLoading() {
  return <ProjectPageLoadingShell />;
}
