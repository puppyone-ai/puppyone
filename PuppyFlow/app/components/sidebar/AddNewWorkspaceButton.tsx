import React, { useState } from 'react';
import { useWorkspaces } from '../states/UserWorkspacesContext';
import { useDisplaySwitch } from '../hooks/useDisplayWorkspcaeSwitching';
import { v4 as uuidv4 } from 'uuid';
import { useAppSettings } from '../states/AppSettingsContext';
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';
import CreateWorkspaceModal from '../blankworkspace/CreateWorkspaceModal';
import workspaceTemplates from '@/lib/templates/workspaceTemplates.json';

function AddNewWorkspaceButton() {
  const {
    workspaceManagement,
    addWorkspace,
    createEmptyWorkspace,
    setShowingItem,
    updateWorkspace,
    workspaces,
  } = useWorkspaces();
  const { switchToWorkspace } = useDisplaySwitch();
  const { planLimits, availableModels } = useAppSettings();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const isWorkspaceLimitReached =
    workspaces && workspaces.length >= planLimits.workspaces;

  const handleAddFlow = async () => {
    if (isWorkspaceLimitReached) {
      // 可以选择在这里再次检查并阻止，或者完全依赖于按钮的 disabled 状态
      console.warn('Workspace limit reached. Cannot create more workspaces.');
      return;
    }
    // 打开创建工作区的菜单
    setIsModalOpen(true);
  };

  const getBlankTemplate = () => ({
    blocks: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    version: '0.0.1',
  });

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
          `[AddNewWorkspaceButton] ✅ API returned success. Workspace ID: ${workspaceId}`,
          { result }
        );

        // Create optimistic workspace with server-generated ID
        const optimistic = createEmptyWorkspace(workspaceId, workspaceName);
        console.log(
          `[AddNewWorkspaceButton] 📦 Created optimistic workspace:`,
          optimistic
        );

        addWorkspace(optimistic);

        console.log(
          `[AddNewWorkspaceButton] 🔄 Fetching workspace content from database...`
        );

        // Fetch workspace content from database
        const switchResult = await workspaceManagement.switchToWorkspace(
          workspaceId,
          optimistic
        );

        if (switchResult.success && switchResult.content) {
          console.log(
            `[AddNewWorkspaceButton] ✅ Fetched content with ${switchResult.content.blocks?.length || 0} blocks`
          );

          // Update workspace with actual content
          // Keep the workspace_name from the optimistic workspace (user-provided name)
          updateWorkspace(workspaceId, {
            workspace_name: workspaceName, // Preserve the name from template instantiation
            content: switchResult.content,
            pullFromDatabase: true,
            pushToDatabase: false,
          });
        } else {
          console.error(
            `[AddNewWorkspaceButton] ❌ Failed to fetch content:`,
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
          `[AddNewWorkspaceButton] ✅ Successfully instantiated template ${templateId} as workspace ${workspaceId}`
        );
      } else {
        console.error(
          `[AddNewWorkspaceButton] ❌ API response missing success or workspace_id:`,
          result
        );
      }
    } catch (error) {
      console.error(
        '[AddNewWorkspaceButton] Failed to instantiate template:',
        error
      );
      // TODO: Show error message to user
    }
  };

  const buttonContent = (
    <button
      className={`w-full h-[32px] pl-[12px] pr-[4px] flex items-center gap-[10px] font-plus-jakarta-sans text-[#6d7177] rounded-md transition-colors group ${
        isWorkspaceLimitReached
          ? 'cursor-not-allowed bg-[#2a2a2a]'
          : 'hover:bg-[#313131] cursor-pointer'
      }`}
      onClick={handleAddFlow}
      disabled={isWorkspaceLimitReached}
    >
      <svg
        width='16'
        height='16'
        viewBox='0 0 16 16'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        className={
          isWorkspaceLimitReached
            ? '[&>*]:stroke-[#4a4a4a]'
            : 'group-hover:[&>*]:stroke-[#CDCDCD]'
        }
      >
        <rect
          x='0.75'
          y='0.75'
          width='14.5'
          height='14.5'
          rx='3.25'
          stroke={isWorkspaceLimitReached ? '#4a4a4a' : '#5D6065'}
          strokeWidth='1.2'
        />
        <path
          d='M8 4V12'
          stroke={isWorkspaceLimitReached ? '#4a4a4a' : '#5D6065'}
          strokeWidth='1.2'
        />
        <path
          d='M4 8L12 8'
          stroke={isWorkspaceLimitReached ? '#4a4a4a' : '#5D6065'}
          strokeWidth='1.2'
        />
      </svg>
      <span
        className={`text-[12px] ${
          isWorkspaceLimitReached
            ? 'text-[#4a4a4a]'
            : 'text-[#5D6065] group-hover:text-[#CDCDCD]'
        }`}
      >
        New
      </span>
    </button>
  );

  return (
    <div className='flex h-[32px] items-center mt-[16px] relative self-stretch w-full'>
      {isWorkspaceLimitReached ? (
        <Tippy
          content={`You have reached the limit of ${planLimits.workspaces} workspaces for your current plan.`}
        >
          <div className='w-full'>{buttonContent}</div>
        </Tippy>
      ) : (
        buttonContent
      )}
      <CreateWorkspaceModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreateWorkspace={createNewWorkspace}
        onCreateWorkspaceFromTemplate={createWorkspaceFromTemplate}
        workspaceTemplates={workspaceTemplates as any}
      />
    </div>
  );
}

export default AddNewWorkspaceButton;
