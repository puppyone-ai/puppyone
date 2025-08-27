import React from 'react';
import { useWorkspaces } from '../states/UserWorkspacesContext';
import { v4 as uuidv4 } from 'uuid';
import { useAppSettings } from '../states/AppSettingsContext';
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';

function AddNewWorkspaceButton() {
  const {
    workspaceManagement,
    addWorkspace,
    createEmptyWorkspace,
    setShowingWorkspace,
    workspaces,
  } = useWorkspaces();
  const { planLimits } = useAppSettings();

  const isWorkspaceLimitReached =
    workspaces && workspaces.length >= planLimits.workspaces;

  const handleAddFlow = async () => {
    if (isWorkspaceLimitReached) {
      // 可以选择在这里再次检查并阻止，或者完全依赖于按钮的 disabled 状态
      console.warn('Workspace limit reached. Cannot create more workspaces.');
      return;
    }
    try {
      // 生成新的工作区 ID 和名称
      const newWorkspaceId = uuidv4();
      const newWorkspaceName = 'Untitled Workspace';

      // 创建空的工作区对象并立即添加到状态中（乐观更新）
      const newWorkspace = createEmptyWorkspace(
        newWorkspaceId,
        newWorkspaceName
      );
      addWorkspace(newWorkspace);

      // 设置为当前显示的工作区
      setShowingWorkspace(newWorkspaceId);

      // 异步创建工作区到数据库
      const createdWorkspace = await workspaceManagement.createWorkspace(
        newWorkspaceId,
        newWorkspaceName
      );

      if (!createdWorkspace) {
        // 如果创建失败，从状态中移除
        console.error('Failed to create workspace');
        // 这里可以添加错误处理，比如显示错误消息
      }
    } catch (error) {
      console.error('Error creating new workspace:', error);
      // 这里可以添加错误处理
    }
  };

  const buttonContent = (
    <button
      className={`w-full h-[32px] pl-[16px] pr-[4px] flex items-center gap-[10px] font-plus-jakarta-sans text-[#6d7177] rounded-md transition-colors group ${
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
          strokeWidth='1.5'
        />
        <path
          d='M8 4V12'
          stroke={isWorkspaceLimitReached ? '#4a4a4a' : '#5D6065'}
          strokeWidth='1.5'
        />
        <path
          d='M4 8L12 8'
          stroke={isWorkspaceLimitReached ? '#4a4a4a' : '#5D6065'}
          strokeWidth='1.5'
        />
      </svg>
      <span
        className={`text-[12px] font-medium ${
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
    <div className='flex h-[32px] items-center mt-[24px] relative self-stretch w-full'>
      {isWorkspaceLimitReached ? (
        <Tippy
          content={`You have reached the limit of ${planLimits.workspaces} workspaces for your current plan.`}
        >
          <div className='w-full'>{buttonContent}</div>
        </Tippy>
      ) : (
        buttonContent
      )}
    </div>
  );
}

export default AddNewWorkspaceButton;
