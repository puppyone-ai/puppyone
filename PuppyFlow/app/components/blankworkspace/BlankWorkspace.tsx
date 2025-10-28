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
  const { planLimits, availableModels } = useAppSettings();
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

  const createWorkspaceFromTemplate = async (
    templateId: string,
    workspaceName: string
  ) => {
    if (isWorkspaceLimitReached) return;

    try {
      // Call new instantiation API (server will generate workspace ID)
      const response = await fetch('/api/workspace/instantiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          templateId,
          workspaceName,
          availableModels,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to instantiate template');
      }

      const result = await response.json();

      if (result?.success && result?.workspace_id) {
        const workspaceId = result.workspace_id;

        console.log(
          `[BlankWorkspace] ✅ API returned success. Workspace ID: ${workspaceId}`,
          { result }
        );

        // Create optimistic workspace with server-generated ID
        const optimistic = createEmptyWorkspace(workspaceId, workspaceName);
        console.log(
          `[BlankWorkspace] 📦 Created optimistic workspace:`,
          optimistic
        );

        addWorkspace(optimistic);

        console.log(
          `[BlankWorkspace] 🔄 Fetching workspace content from database...`
        );

        // Fetch workspace content from database
        const switchResult = await workspaceManagement.switchToWorkspace(
          workspaceId,
          optimistic
        );

        if (switchResult.success && switchResult.content) {
          console.log(
            `[BlankWorkspace] ✅ Fetched content with ${switchResult.content.blocks?.length || 0} blocks`
          );

          // Update workspace with actual content
          updateWorkspace(workspaceId, {
            content: switchResult.content,
            pullFromDatabase: true,
            pushToDatabase: false,
          });
        } else {
          console.error(
            `[BlankWorkspace] ❌ Failed to fetch content:`,
            switchResult.error
          );
        }

        // Switch UI to show the new workspace
        setShowingItem({
          type: 'workspace',
          id: workspaceId,
          name: workspaceName,
        });
        switchToWorkspace();

        console.log(
          `[BlankWorkspace] ✅ Successfully instantiated template ${templateId} as workspace ${workspaceId}`
        );
      } else {
        console.error(
          `[BlankWorkspace] ❌ API response missing success or workspace_id:`,
          result
        );
      }
    } catch (error) {
      console.error('[BlankWorkspace] Failed to instantiate template:', error);
      // TODO: Show error message to user
    }
  };

  const templates = [
    {
      key: 'getting-started',
      templateId: 'getting-started',
      title: 'Getting Started',
      description: 'A guided workspace to learn the basics in minutes',
      getContent: () => (workspaceTemplates as any).onboarding_guide?.content,
    },
    {
      key: 'agentic-rag',
      templateId: 'agentic-rag',
      title: 'Agentic RAG',
      description:
        'Plan + retrieve + cite sources. Works best with a retriever',
      getContent: () => (workspaceTemplates as any).agentic_rag?.content,
    },
    {
      key: 'file-load',
      templateId: 'file-load',
      title: 'File Content Extraction',
      description:
        'Extract file contents and ingest them into your knowledge base',
      getContent: () =>
        (workspaceTemplates as any).file_content_extraction?.content,
    },
    {
      key: 'seo-blog',
      templateId: 'seo-blog',
      title: 'SEO Blog Generator',
      description: 'Generate and optimize SEO content with automated workflows',
      getContent: () => (workspaceTemplates as any).seo?.content,
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
                Create custom views using filters to show only the issues you
                want to see. You can save, share, and favorite these views for
                easy access and faster team collaboration.
              </p>
            </div>

            {/* Create Button */}
            <div className='w-full max-w-[340px] flex justify-start gap-3'>
              <button
                onClick={() => setIsModalOpen(true)}
                disabled={isWorkspaceLimitReached}
                className={`h-[28px] px-[14px] rounded-[6px] text-[12px] font-medium transition-all duration-200 flex items-center justify-center
                  ${
                    isWorkspaceLimitReached
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
        onCreateWorkspaceFromTemplate={createWorkspaceFromTemplate}
        workspaceTemplates={workspaceTemplates}
      />
    </div>
  );
};

export default BlankWorkspace;
