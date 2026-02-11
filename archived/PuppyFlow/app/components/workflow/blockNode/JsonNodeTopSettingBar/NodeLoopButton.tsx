import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext';
import React, { useState, useRef, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';

type NodeLoopButtonProps = {
  nodeid: string;
};

function NodeLoopButton({ nodeid }: NodeLoopButtonProps) {
  const [isHovered, setHovered] = useState(false);
  const loopButtonRef = useRef<HTMLButtonElement | null>(null);
  const { activatedNode } = useNodesPerFlowContext();
  const { setNodes, getNode } = useReactFlow();

  // 获取当前节点的 looped 状态
  const node = getNode(nodeid);
  type ExtendedNode = typeof node & { looped?: boolean };
  const isLooped = (node as ExtendedNode)?.looped || false;

  const toggleLoopState = () => {
    console.log('toggleLoopState: setting loop state to', !isLooped);
    setNodes(prevNodes =>
      prevNodes.map(node => {
        if (node.id === nodeid) {
          return {
            ...node,
            looped: !isLooped,
            data: {
              ...node.data,
              looped: !isLooped,
            },
          };
        }
        return node;
      })
    );
  };

  const onMouseEnter = () => {
    setHovered(true);
  };

  const onMouseLeave = () => {
    setHovered(false);
  };

  // 移除条件 opacity 控制，使按钮始终可见
  return (
    <button
      ref={loopButtonRef}
      className={`flex items-center justify-center min-w-[24px] min-h-[24px] rounded-[8px] cursor-pointer group
                 ${isHovered ? 'bg-[#3E3E41]' : ''}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={toggleLoopState}
      title='Loop'
    >
      <svg
        width='16'
        height='16'
        viewBox='0 0 16 16'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
      >
        <path
          d='M13.6572 10C12.8334 12.3302 10.6123 14 8 14C5.38772 14 3.16657 12.3302 2.34277 10H3.96875C4.70518 11.4815 6.2333 12.5 8 12.5C9.7667 12.5 11.2948 11.4815 12.0312 10H13.6572ZM8 2C10.6123 2 12.8334 3.66984 13.6572 6H12.0312C11.2948 4.5185 9.7667 3.5 8 3.5C6.2333 3.5 4.70518 4.5185 3.96875 6H2.34277C3.16657 3.66984 5.38772 2 8 2Z'
          fill={isLooped ? '#39BC66' : '#6D7177'}
          className={isLooped ? '' : 'group-hover:fill-[#CDCDCD] '}
        />
        <path
          d='M14 3L13.5 6.5L10 6.5'
          stroke={isLooped ? '#39BC66' : '#6D7177'}
          strokeWidth='1.5'
          className={isLooped ? '' : 'group-hover:stroke-[#CDCDCD] '}
        />
        <path
          d='M2 13L2.5 9.5H6'
          stroke={isLooped ? '#39BC66' : '#6D7177'}
          strokeWidth='1.5'
          className={isLooped ? '' : 'group-hover:stroke-[#CDCDCD] '}
        />
      </svg>
    </button>
  );
}

export default NodeLoopButton;
