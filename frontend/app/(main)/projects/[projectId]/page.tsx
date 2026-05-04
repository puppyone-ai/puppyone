import { redirect } from 'next/navigation';

interface ProjectPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { projectId } = await params;
  
  redirect(`/projects/${projectId}/data`);
}






