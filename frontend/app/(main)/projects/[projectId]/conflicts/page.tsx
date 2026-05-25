import { redirect } from 'next/navigation';

export default async function ConflictsPage({
  params,
}: Readonly<{ params: Promise<{ projectId: string }> }>) {
  const { projectId } = await params;
  redirect(`/projects/${projectId}/changes`);
}
