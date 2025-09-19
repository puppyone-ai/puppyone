import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useWorkspaces } from '../states/UserWorkspacesContext';
import { useAppSettings } from '../states/AppSettingsContext';
import workspaceTemplates from '@/lib/templates/workspaceTemplates.json';
import { useDisplaySwitch } from '../hooks/useDisplayWorkspcaeSwitching';
import CreateWorkspaceModal from './CreateWorkspaceModal';

const BlankWorkspace = () => {
  const {
    workspaces,
    addWorkspace,
    createEmptyWorkspace,
    setShowingItem,
    updateWorkspace,
    workspaceManagement,
  } = useWorkspaces();
  const { planLimits } = useAppSettings();
  const { switchToWorkspace } = useDisplaySwitch();
  const [isModalOpen, setIsModalOpen] = useState(false);

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
    setShowingItem({
      type: 'workspace',
      id: newWorkspaceId,
      name: newWorkspaceName,
    });
    switchToWorkspace();

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
        <div className='w-full max-w-[600px] h-full px-6 flex flex-col font-plus-jakarta-sans'>
          <div className='flex-1 flex flex-col items-center justify-center text-center py-10'>
            {/* Puppy Logo */}
            <div className='mb-8 w-full max-w-[340px] flex justify-start'>
              <img
                src='/puppysvg.png'
                alt='Puppy Logo'
                width={60}
                className='opacity-90'
              />
            </div>

            {/* Title and Description */}
            <div className='mb-8 max-w-[340px]'>
              <h1 className='text-[15px] font-medium text-[#F0F0F0] mb-[10px] leading-tight text-left'>
                PuppyAgent
              </h1>
              <p className='text-[13px] text-[#8B8B8B] leading-relaxed text-left'>
                Create custom views using filters to show only the issues you want to see. 
                You can save, share, and favorite these views for easy access and faster team collaboration.
              </p>
            </div>

            {/* Create Button */}
            <div className='w-full max-w-[340px] flex justify-start gap-3'>
              <button
                onClick={() => setIsModalOpen(true)}
                disabled={isWorkspaceLimitReached}
                className={`h-[28px] px-[14px] rounded-[6px] text-[12px] font-medium transition-all duration-200 flex items-center justify-center
                  ${isWorkspaceLimitReached 
                    ? 'bg-[#232323] text-[#5A5A5A] cursor-not-allowed' 
                    : 'bg-[#4599DF] hover:bg-[#3A85CC] text-white shadow-sm hover:shadow-md'
                  }`}
              >
                Create new workspace
              </button>
              <button
                onClick={() => {
                  window.open('https://doc.puppyagent.com/', '_blank');
                }}
                className='h-[28px] px-[14px] rounded-[6px] text-[12px] font-medium transition-all duration-200 flex items-center justify-center bg-[#2A2A2A] hover:bg-[#333333] text-[#CDCDCD] border border-[#404040] hover:border-[#505050]'
              >
                Documentation
              </button>
            </div>

            {isWorkspaceLimitReached && (
              <p className='text-[12px] text-[#6A6A6A] mt-3'>
                You have reached your plan limit.
              </p>
            )}
          </div>

        </div>
      </div>

      {/* Create Workspace Modal */}
      <CreateWorkspaceModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreateWorkspace={createNewWorkspace}
        workspaceTemplates={workspaceTemplates}
      />
    </div>
  );
};

export default BlankWorkspace;
