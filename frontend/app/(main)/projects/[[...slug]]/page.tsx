import { redirect } from 'next/navigation';

/**
 * Legacy Route Redirect
 * 
 * This catch-all route handles legacy URLs and redirects to the new structure:
 * 
 * Old:  /projects/{projectId}/{path...}
 * New:  /projects/{projectId}/data/{path...}
 * 
 * Also handles:
 * - /projects → /home
 * - /projects/{projectId} → /projects/{projectId}/data
 */

interface LegacyPageProps {
  params: Promise<{ slug?: string[] }>;
}

export default async function LegacyRedirectPage({ params }: LegacyPageProps) {
  const { slug } = await params;

  // No slug → redirect to home
  if (!slug || slug.length === 0) {
    redirect('/home');
  }

  const [projectId, ...restPath] = slug;

  // Just projectId → redirect to data view
  if (restPath.length === 0) {
    redirect(`/projects/${projectId}/data`);
  }

  // Check if it's already using new routes (data, tools, settings)
  const firstSegment = restPath[0];
  if (['data', 'tools', 'settings'].includes(firstSegment)) {
    // Already new format, this shouldn't happen but let it pass
    // The actual route handler should catch this
    redirect(`/projects/${projectId}/${restPath.join('/')}`);
  }

  // Legacy format: /projects/{projectId}/{nodeId...}
  // Redirect to: /projects/{projectId}/data/{nodeId...}
  redirect(`/projects/${projectId}/data/${restPath.join('/')}`);
}
