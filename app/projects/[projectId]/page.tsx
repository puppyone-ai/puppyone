'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../supabase/SupabaseAuthProvider';
import { HeaderBar } from '../../../components/HeaderBar';
import { ProjectSidebar } from '../../../components/ProjectSidebar';
import type { ProjectTableJSON } from '../../../lib/projectData';
import { fetchProjectTableData, fetchProjectTablesData } from '../../../lib/projectData';
import { mockProjects } from '../../../lib/mock';
import { McpBar } from '../../../components/McpBar';
import dynamic from 'next/dynamic';

const JsonEditorWithNoSSR = dynamic(() => import('../../../components/JsonEditorComponent'), {
  ssr: false,
  loading: () => (
    <div style={{ padding: '20px', color: '#94a3b8', fontFamily: 'Inter, system-ui, sans-serif' }}>
      Loading Editor...
    </div>
  ),
});

export default function ProjectDetailPage() {
  const { session, isAuthReady } = useAuth();
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const projectId = Array.isArray(params?.projectId) ? params.projectId[0] : params?.projectId ?? '';
  const project = mockProjects.find((p) => p.id === projectId);

  const [activeTableId, setActiveTableId] = useState(project?.tables[0]?.id ?? '');
  const [viewMode, setViewMode] = useState<'sidebar' | 'grid'>('sidebar');

  useEffect(() => {
    if (isAuthReady && !session) {
      router.replace('/login');
    }
  }, [isAuthReady, session, router]);

  useEffect(() => {
    if (project?.tables?.length) {
      setActiveTableId(project.tables[0].id);
    } else {
      setActiveTableId('');
    }
  }, [projectId, project?.tables]);

  useEffect(() => {
    if (isAuthReady && session && !project) {
      router.replace('/projects');
    }
  }, [isAuthReady, session, project, router]);

  const activeTable = project?.tables.find((t) => t.id === activeTableId);
  const [tableData, setTableData] = useState<ProjectTableJSON | undefined>(undefined);
  const [gridData, setGridData] = useState<Record<string, ProjectTableJSON | undefined>>({});

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!activeTableId) {
        setTableData(undefined);
        return;
      }
      const data = await fetchProjectTableData(projectId, activeTableId);
      if (!cancelled) setTableData(data);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [projectId, activeTableId]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!project?.tables?.length || viewMode !== 'grid') return;
      const ids = project.tables.map((t) => t.id);
      const all = await fetchProjectTablesData(projectId, ids);
      if (!cancelled) setGridData(all);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [projectId, viewMode, project?.tables]);

  const overlayMessage = !isAuthReady ? 'Loading…' : session ? undefined : 'Redirecting…';

  return (
    <main
      style={{
        minHeight: '100vh',
        backgroundColor: '#050505',
        color: '#f4f4f5',
        fontFamily: 'Inter, system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {session && (
        <HeaderBar
          userAvatarUrl={
            (session.user as any)?.user_metadata?.avatar_url || (session.user as any)?.user_metadata?.picture
          }
        />
      )}

      <div
        style={{
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          backgroundColor: '#0d0f12',
          padding: '10px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => router.push('/projects')}
            aria-label="Back to projects"
            style={{
              height: 28,
              width: 28,
              borderRadius: 6,
              border: '1px solid rgba(148,163,184,0.35)',
              backgroundColor: 'transparent',
              color: '#cbd5f5',
              fontSize: 16,
              lineHeight: '26px',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
            }}
          >
            ←
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#f8fafc' }}>{project?.name ?? 'Project'}</div>
            {project?.description && <div style={{ fontSize: 12, color: '#94a3b8' }}>{project.description}</div>}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {project && project.tables.length > 0 ? (
          <>
            <aside
              style={{
                width: 240,
                borderRight: '1px solid rgba(255,255,255,0.04)',
                background: '#0b0e13',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div
                  role="group"
                  aria-label="View mode"
                  style={{
                    display: 'inline-flex',
                    border: '1px solid rgba(148,163,184,0.35)',
                    borderRadius: 8,
                    overflow: 'hidden',
                    background: '#0b0e13',
                  }}
                >
                  <button
                    onClick={() => setViewMode('sidebar')}
                    style={{
                      height: 28,
                      padding: '0 10px',
                      fontSize: 12,
                      color: viewMode === 'sidebar' ? '#e5e7eb' : '#94a3b8',
                      background: viewMode === 'sidebar' ? '#1a1f29' : 'transparent',
                      border: 'none',
                      borderRight: '1px solid rgba(148,163,184,0.35)',
                      cursor: 'pointer',
                    }}
                  >
                    Sidebar
                  </button>
                  <button
                    onClick={() => setViewMode('grid')}
                    style={{
                      height: 28,
                      padding: '0 10px',
                      fontSize: 12,
                      color: viewMode === 'grid' ? '#e5e7eb' : '#94a3b8',
                      background: viewMode === 'grid' ? '#1a1f29' : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    Grid
                  </button>
                </div>
              </div>
              {viewMode === 'sidebar' && (
                <ProjectSidebar tables={project.tables} activeId={activeTableId} onSelect={setActiveTableId} />
              )}
            </aside>

            {viewMode === 'sidebar' ? (
              <section style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#050607' }}>
                <div
                  style={{
                    padding: '16px 24px 0',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    background: '#080a0d',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span
                        style={{
                          fontSize: 12,
                          padding: '4px 8px',
                          borderRadius: 999,
                          backgroundColor: 'rgba(59,130,246,0.1)',
                          color: '#bfdbfe',
                          letterSpacing: 0.5,
                        }}
                      >
                        Table
                      </span>
                      <div style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0' }}>{activeTable?.name}</div>
                      {activeTable?.rows != null && (
                        <div
                          style={{
                            fontSize: 11,
                            color: '#94a3b8',
                            padding: '2px 6px',
                            borderRadius: 6,
                            backgroundColor: 'rgba(148,163,184,0.12)',
                          }}
                        >
                          {activeTable.rows} rows
                        </div>
                      )}
                    </div>
                    <McpBar />
                  </div>
                  <div style={{ marginTop: 12, fontSize: 11, color: '#6b7280' }}>
                    Showing mock data as JSON for quick inspection.
                  </div>
                </div>

                <div style={{ flex: 1, padding: '18px 24px', overflowY: 'hidden', display: 'flex' }}>
                  {tableData ? (
                    <div style={{ flex: 1, borderRadius: 10, overflow: 'hidden' }}>
                      <JsonEditorWithNoSSR json={tableData} />
                    </div>
                  ) : (
                    <div
                      style={{
                        height: '100%',
                        display: 'grid',
                        placeItems: 'center',
                        color: '#94a3b8',
                        fontSize: 13,
                      }}
                    >
                      Select a table to view its data.
                    </div>
                  )}
                </div>
              </section>
            ) : (
              <section style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#050607' }}>
              <div
                style={{
                  padding: '16px 24px',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  background: '#080a0d',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0' }}>Grid view</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{project.tables.length} tables</div>
                </div>
                <McpBar />
              </div>
              <div
                style={{
                  flex: 1,
                  padding: 20,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
                  gap: 14,
                  overflowY: 'auto',
                }}
              >
                   {project.tables.map((t) => {
                     const data = gridData[t.id];
                  return (
                    <div
                      key={t.id}
                      style={{
                        background: 'rgba(17,24,39,0.55)',
                        border: '1px solid rgba(148,163,184,0.12)',
                        borderRadius: 10,
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 12px',
                          borderBottom: '1px solid rgba(148,163,184,0.12)',
                          background: '#0e1117',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span
                            style={{
                              width: 8,
                              height: 24,
                              borderRadius: 4,
                              background: '#4E5AF7',
                              display: 'inline-block',
                            }}
                          />
                          <div style={{ fontWeight: 600, fontSize: 13, color: '#e5e7eb' }}>{t.name}</div>
                        </div>
                        {typeof t.rows === 'number' && (
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>{t.rows} rows</div>
                        )}
                      </div>
                      <div
                        style={{
                          flex: 1,
                          overflow: 'hidden', // The editor has its own scroll
                        }}
                      >
                        {data ? (
                          <JsonEditorWithNoSSR json={data} />
                        ) : (
                          <div
                            style={{
                              padding: '14px 16px',
                              fontFamily: "'JetBrains Mono', SFMono-Regular, Menlo, monospace",
                              fontSize: 12,
                              color: '#94a3b8',
                            }}
                          >
                            No data
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
            )}
          </>
        ) : (
          <div
            style={{
              flex: 1,
              display: 'grid',
              placeItems: 'center',
              color: '#94a3b8',
              fontSize: 14,
            }}
          >
            {project ? 'No tables available for this project.' : 'Loading project…'}
          </div>
        )}
      </div>

      {overlayMessage && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.55)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 16,
            letterSpacing: 1,
            color: '#d4d4d8',
          }}
        >
          {overlayMessage}
        </div>
      )}
    </main>
  );
}


