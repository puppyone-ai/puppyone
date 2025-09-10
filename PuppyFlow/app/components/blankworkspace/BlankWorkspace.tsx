import React from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useWorkspaces } from '../states/UserWorkspacesContext';
import { useAppSettings } from '../states/AppSettingsContext';
import workspaceTemplates from '@/lib/templates/workspaceTemplates.json';

const BlankWorkspace = () => {
  const {
    workspaces,
    addWorkspace,
    createEmptyWorkspace,
    setShowingWorkspace,
    updateWorkspace,
    workspaceManagement,
  } = useWorkspaces();
  const { planLimits } = useAppSettings();

  const isWorkspaceLimitReached =
    workspaces && workspaces.length >= planLimits.workspaces;

  const createNewWorkspace = async (
    initialContent?: any,
    workspaceNameOverride?: string
  ) => {
    if (isWorkspaceLimitReached) return;

    const newWorkspaceId = uuidv4();
    const newWorkspaceName = workspaceNameOverride || 'Untitled Workspace';

    const optimistic = createEmptyWorkspace(newWorkspaceId, newWorkspaceName);
    addWorkspace(optimistic);
    setShowingWorkspace(newWorkspaceId);

    try {
      const result = await workspaceManagement.createWorkspaceWithContent(
        newWorkspaceId,
        newWorkspaceName,
        initialContent || getBlankTemplate()
      );
      if (result?.success && result.content) {
        updateWorkspace(newWorkspaceId, {
          content: result.content,
          pullFromDatabase: true,
          pushToDatabase: false,
        });
      }
    } catch (error) {
      console.error('Failed to create workspace:', error);
    }
  };

  const getBlankTemplate = () => ({
    blocks: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    version: '0.0.1',
  });

  const templates = [
    {
      key: 'personal-rss',
      title: (workspaceTemplates as any).personal_rss.title,
      description: (workspaceTemplates as any).personal_rss.description,
      getContent: () => (workspaceTemplates as any).personal_rss.content,
    },
    {
      key: 'agentic-rag',
      title: (workspaceTemplates as any).agentic_rag.title,
      description: (workspaceTemplates as any).agentic_rag.description,
      getContent: () => (workspaceTemplates as any).agentic_rag.content,
    },
    {
      key: 'article-writer',
      title: (workspaceTemplates as any).article_writer.title,
      description: (workspaceTemplates as any).article_writer.description,
      getContent: () => (workspaceTemplates as any).article_writer.content,
    },
  ];

  // Templates are shown at the bottom; only a single top CTA remains

  return (
    <div className='w-full h-full overflow-hidden pt-[8px] pb-[8px] pr-[8px] pl-[0px] bg-[#252525]'>
      <div className='w-full h-full border-[1px] border-[#303030] bg-[#181818] rounded-[8px] flex items-center justify-center'>
        <div className='w-full max-w-[960px] h-full px-6 md:px-10 lg:px-16 flex flex-col font-plus-jakarta-sans'>
          <div className='flex-1 flex flex-col items-center justify-center text-center gap-4 py-10'>
            <svg
              width='112'
              height='94'
              viewBox='0 0 223 188'
              fill='none'
              xmlns='http://www.w3.org/2000/svg'
              className='opacity-80'
            >
              <path
                d='M131.621 62.5L137.428 68.3066L137.489 68.8223L142.489 110.822L142.555 111.372L131.803 127.5H92.1973L81.4453 111.372L81.5107 110.822L86.5107 68.8223L86.5723 68.3066L92.3789 62.5H131.621Z'
                fill='#FFA73D'
                stroke='#1C1D1F'
                strokeWidth='3'
              />
              <path
                d='M113 105.001L113 108.63C112.999 110.151 112.383 111.617 111.28 112.72L110.408 113.592C109.494 114.506 108.299 115.116 107.001 115.333L106.206 115.465C104.201 115.799 102.162 115.161 100.762 113.762L99.0002 112'
                stroke='#1C1D1F'
                strokeWidth='3'
              />
              <path
                d='M113 104L113 108.657C113 110.162 113.603 111.604 114.685 112.686L115.623 113.624C116.518 114.518 117.688 115.115 118.966 115.328L119.772 115.462C121.788 115.799 123.856 115.145 125.28 113.721L127 112'
                stroke='#1C1D1F'
                strokeWidth='3'
              />
              <path
                d='M125.381 80L117.381 86L125.5 91.5'
                stroke='#1C1D1F'
                strokeWidth='3'
              />
              <path
                d='M99.3813 80L107.381 86L99.3813 92'
                stroke='#1C1D1F'
                strokeWidth='3'
              />
              <path
                d='M151.584 60.7565L155.093 91.5572L141.183 93.142L137.674 62.3413L151.584 60.7565Z'
                fill='#FFA73D'
                stroke='#1C1D1F'
                strokeWidth='4'
              />
              <path
                d='M86.0931 62.3405L82.5838 93.1413L68.6738 91.5564L72.1831 60.7557L86.0931 62.3405Z'
                fill='#FFA73D'
                stroke='#1C1D1F'
                strokeWidth='4'
              />
              <rect x='104' y='97' width='17' height='8' fill='#1C1D1F' />
              <rect x='110' y='99' width='6' height='1' fill='white' />
            </svg>
            <h2 className='text-[#EDEDED] antialiased font-serif italic tracking-tight leading-snug text-[20px] md:text-[22px] font-normal'>
              The new base for your agents
            </h2>
            <button
              onClick={() =>
                createNewWorkspace(
                  (workspaceTemplates as any).onboarding_guide.content,
                  'Getting Started'
                )
              }
              disabled={isWorkspaceLimitReached}
              className={`mt-4 md:mt-5 h-[48px] px-6 rounded-[8px] border text-[14px] transition-colors duration-200 flex items-center gap-3 justify-center 
                ${isWorkspaceLimitReached ? 'bg-[#232323] border-[#2E2E2E] text-[#5A5A5A] cursor-not-allowed' : 'bg-[#242424] hover:bg-[#343434] border-[#2A2A2A] text-[#B8B8B8]'}`}
            >
              <svg
                width='18'
                height='18'
                viewBox='0 0 18 18'
                fill='none'
                xmlns='http://www.w3.org/2000/svg'
                className='opacity-90'
              >
                <rect
                  x='2.25'
                  y='2.25'
                  width='13.5'
                  height='13.5'
                  rx='3'
                  stroke='currentColor'
                />
                <path d='M5 9h8' stroke='currentColor' />
                <path d='M9 5v8' stroke='currentColor' />
              </svg>
              Create Getting Started workspace
            </button>
            {isWorkspaceLimitReached && (
              <span className='text-[12px] text-[#6A6A6A]'>
                You have reached your plan limit.
              </span>
            )}
          </div>

          <div className='mt-auto'>
            <div className='flex items-center gap-4 text-[#5E5E5E] text-[12px] mt-8 mb-4'>
              <div className='h-px flex-1 bg-[#2A2A2A]' />
              <span>or choose a template</span>
              <div className='h-px flex-1 bg-[#2A2A2A]' />
            </div>

            <div className='grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 pb-12'>
              {templates.map(t => (
                <button
                  key={t.key}
                  onClick={() => createNewWorkspace(t.getContent())}
                  disabled={isWorkspaceLimitReached}
                  className={`group text-left rounded-[10px] border p-4 transition-colors 
                    ${isWorkspaceLimitReached ? 'cursor-not-allowed border-[#2A2A2A] bg-[#1E1E1E] opacity-80' : 'hover:border-[#3A3A3A] border-[#2A2A2A] bg-[#1E1E1E]'}`}
                >
                  <div className='flex items-center gap-3'>
                    <div className='w-[36px] h-[36px] rounded-[8px] bg-[#222222] border border-[#2B2B2B] flex items-center justify-center'>
                      <svg
                        width='18'
                        height='18'
                        viewBox='0 0 18 18'
                        fill='none'
                        xmlns='http://www.w3.org/2000/svg'
                        className='opacity-80'
                      >
                        <rect
                          x='2.25'
                          y='2.25'
                          width='13.5'
                          height='13.5'
                          rx='3'
                          stroke='#7C7C7C'
                        />
                        <path d='M5 9h8' stroke='#7C7C7C' />
                        <path d='M9 5v8' stroke='#7C7C7C' />
                      </svg>
                    </div>
                    <div className='flex-1'>
                      <div className='text-[#D6D6D6] text-[13px] font-medium'>
                        {t.title}
                      </div>
                      <div className='text-[#8B8B8B] text-[12px] mt-[2px]'>
                        {t.description}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BlankWorkspace;
