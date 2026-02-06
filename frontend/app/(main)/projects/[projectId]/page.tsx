import { redirect } from 'next/navigation';

interface ProjectPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { projectId } = await params;
  
  // Redirect to data view by default
  redirect(`/projects/${projectId}/data`);
}





