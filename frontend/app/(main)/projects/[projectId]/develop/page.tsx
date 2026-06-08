import { redirect } from 'next/navigation';

export default async function DevelopPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/projects/${projectId}/develop/logs`);
}
