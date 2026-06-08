import { redirect } from 'next/navigation';

export default async function MonitorRedirectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/projects/${projectId}/develop/logs`);
}
