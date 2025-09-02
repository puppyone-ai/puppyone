import React, { useState, useRef } from 'react';
import { useWorkspaces } from '../states/UserWorkspacesContext';
import { useDisplaySwitch } from '../hooks/useDisplayWorkspcaeSwitching';
import FlowElementOperationMenu from './FlowElementOperationMenu';

type FlowElementProps = {
  FlowId: string;
  FlowName: string;
  isDirty?: boolean;
  handleOperationMenuShow: (flowId: string | null) => void;
  flowIdShowOperationMenu: string | null;
  // showFlowName: (flowId: string) => string;
  // editFlow: (flowId: string, flowName: string) => void;
  // removeFlow: (flowId: string) => void;
};

function FlowElement({
  FlowId,
  FlowName,
  isDirty = false,
  handleOperationMenuShow,
  flowIdShowOperationMenu,
}: FlowElementProps) {
  // 需要定义一个css 条件是当hover到这个flow bar 时，bg背景颜色需要变化 bg-[#3d3e41]

  const [isHover, setIsHover] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // 使用 useWorkspaces 获取基础状态
  const {
    showingItem,
    displayOrNot,
    updateWorkspace,
    workspaceManagement,
    getWorkspaceById,
  } = useWorkspaces();

  // 使用 useDisplaySwitch 获取切换方法
  const { switchToWorkspaceById } = useDisplaySwitch();

  const selectedFlowId =
    showingItem?.type === 'workspace' ? showingItem.id : null;

  // 修改选中状态的判断逻辑：只有当 displayOrNot 为 true 且选中了该工作区时才显示为选中状态
  const isSelected = displayOrNot && FlowId === selectedFlowId;

  const handleFlowSwitch = async (flowId: string) => {
    // 获取现有工作区信息
    const existingWorkspace = getWorkspaceById(flowId);

    // 调用 workspaceManagement 的 switchToWorkspace 方法获取工作区内容
    const result = await workspaceManagement.switchToWorkspace(
      flowId,
      existingWorkspace
    );

    if (result.success && result.content) {
      // 只有当数据来自数据库时才更新 pullFromDatabase 状态
      if (!result.fromCache) {
        updateWorkspace(flowId, {
          content: result.content,
          pullFromDatabase: true, // 标记为已从数据库拉取
        });
      }

      // 不再需要手动设置 currentWorkspaceJson，因为它现在是通过 getCurrentWorkspaceContent 计算得出的
      // 当 updateWorkspace 更新工作区内容后，getCurrentWorkspaceContent 会自动返回最新内容
    } else {
      console.error('Failed to switch workspace:', result.error);
    }

    // 使用 useDisplaySwitch 的方法来切换显示状态
    // 这会同时处理工作区显示模式的切换和服务显示模式的关闭
    switchToWorkspaceById(flowId);
  };

  return (
    <li
      className={`
      flex items-center justify-center pl-[12px] pr-[4px] h-[32px] w-full gap-[10px] rounded-[6px] cursor-pointer relative
      ${
        isSelected || flowIdShowOperationMenu === FlowId
          ? 'bg-[#454545] hover:bg-[#454545] transition-colors duration-200'
          : 'hover:bg-[#313131] transition-colors duration-200'
      }
    `}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
      onClick={e => {
        e.preventDefault();
        e.stopPropagation();
        handleFlowSwitch(FlowId);
      }}
    >
      <div
        className={`flex items-center justify-start min-h-[32px] text-left text-[13px] rounded-[6px] w-full font-plus-jakarta-sans 
      ${isSelected ? 'text-white' : 'text-[#CDCDCD]'}
      FlowElementInput border-none outline-none bg-transparent`}
      >
        <div
          className='flex items-center gap-[8px] max-w-[166px]'
          title={`${FlowName}${isDirty ? ' (unsaved)' : ''}`}
        >
          <span className='truncate'>{FlowName}</span>
          {isDirty && (
            <span
              className='flex-shrink-0 w-[6px] h-[6px] rounded-full bg-[#FF8B6A] relative group cursor-default'
              title='unsaved'
            ></span>
          )}
        </div>
      </div>
      <div
        className={`w-[24px] h-[24px] ${flowIdShowOperationMenu === FlowId || isHover ? 'flex' : 'hidden'}`}
      >
        {' '}
        {/* 添加固定宽度的容器 */}
        <button
          ref={buttonRef}
          className='flex items-center justify-center w-[24px] h-[24px] text-[#CDCDCD] rounded-[4px] hover:bg-[#5C5D5E] transition-colors duration-200'
          onClick={e => {
            e.preventDefault();
            e.stopPropagation();
            handleOperationMenuShow(FlowId);
            // removeFlow(FlowId)
          }}
        >
          <svg
            xmlns='http://www.w3.org/2000/svg'
            width='24'
            height='24'
            viewBox='0 0 24 24'
            fill='none'
            className='group transition-colors duration-200'
          >
            <path
              d='M7 11H9V13H7V11Z'
              className='fill-[#5D6065] group-hover:fill-white transition-colors duration-200'
            />
            <path
              d='M16 11H18V13H16V11Z'
              className='fill-[#5D6065] group-hover:fill-white transition-colors duration-200'
            />
            <path
              d='M11.5 11H13.5V13H11.5V11Z'
              className='fill-[#5D6065] group-hover:fill-white transition-colors duration-200'
            />
          </svg>
        </button>
        <FlowElementOperationMenu
          flowId={FlowId}
          show={flowIdShowOperationMenu === FlowId}
          handleOperationMenuHide={() => handleOperationMenuShow(null)}
          buttonRef={buttonRef}
        />
      </div>
    </li>
  );
}

export default FlowElement;
