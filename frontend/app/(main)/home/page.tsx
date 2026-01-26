'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useProjects } from '@/lib/hooks/useData';
import { DashboardView } from '@/components/dashboard/DashboardView';
import { ProjectManageDialog } from '@/components/ProjectManageDialog';

export default function DashboardPage() {
  const router = useRouter();
  const { projects, isLoading: projectsLoading } = useProjects();
  const [createProjectOpen, setCreateProjectOpen] = useState(false);

  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        backgroundColor: '#202020', // 一级 sidebar 的背景色作为整个页面底色
      }}
    >
      {/* --- 浮动容器：与 projects/layout.tsx 保持一致 --- */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          margin: 8,
          marginLeft: 0,
          borderRadius: 12,
          border: '1px solid #2a2a2a',
          background: '#0e0e0e',
          overflow: 'hidden',
        }}
      >
        <DashboardView
          projects={projects}
          loading={projectsLoading}
          onProjectClick={projectId => router.push(`/projects/${projectId}`)}
          onCreateClick={() => setCreateProjectOpen(true)}
        />
      </div>

      {createProjectOpen && (
        <ProjectManageDialog
          mode='create'
          projectId={null}
          projects={projects}
          onClose={() => setCreateProjectOpen(false)}
        />
      )}
    </div>
  );
}
