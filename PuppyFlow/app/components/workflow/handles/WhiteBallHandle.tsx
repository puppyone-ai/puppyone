import React, { useEffect, useState } from 'react';
import {
  HandleProps,
  Handle,
  Position,
  Connection,
  useReactFlow,
} from '@xyflow/react';
import { useNodeContext } from '../../states/NodeContext';
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext';

type WhiteBallHandleProps = HandleProps & {
  sourceNodeId: string;
  // need a new prop: nodeType
};

type HandleNames =
  | 'TopSrcHandle'
  | 'BottomSrcHandle'
  | 'LeftSrcHandle'
  | 'RightSrcHandle';

function WhiteBallHandle({ sourceNodeId, ...props }: WhiteBallHandleProps) {
  // console.log(sourceNodeId)
  // design handle bar with multiple handles, must add id for handle
  // const {nodes, searchNode, preventActivateNode, allowActivateNode, activateNode, preventInactivateNode, activateHandle, inactivateHandle, allowInactivateNode} = useNodeContext()
  const {
    activatedNode,
    activateNode,
    inactivateNode,
    setHandleActivated,
    preventInactivateNode,
    allowInactivateNodeWhenClickOutside,
    clearAll,
    clearEdgeActivation,
  } = useNodesPerFlowContext();
  const { getNode } = useReactFlow();

  // const handlePositions = {
  //   [Position.Top]: 'TopSrcHandle',
  //   [Position.Bottom]: 'BottomSrcHandle',
  //   [Position.Left]: 'LeftSrcHandle',
  //   [Position.Right]: 'RightSrcHandle',
  // };
  // const handleName = handlePositions[props.position] as HandleNames;

  function judgeDisplay() {
    let showHandle = false;
    const sourceNode = getNode(sourceNodeId);
    if (!sourceNode) return 'transparent';
    // showHandle = sourceNode[handleName].isConnected

    // if (showHandle && !sourceNode.activated) return ""
    // else if (!showHandle && !sourceNode.activated) return "transparent"
    // else return "active"

    return activatedNode?.id === sourceNodeId ? 'active' : 'transparent';
  }

  const onClickAction = (
    event: React.MouseEvent<HTMLDivElement, MouseEvent>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    console.log(sourceNodeId, props.position);
    // onHandleClick(props.position)
    const sourceNode = getNode(sourceNodeId);
    if (!sourceNode) return;
    if (activatedNode?.id !== sourceNodeId) {
      clearAll();
      // activateNode(sourceNodeId)
      setHandleActivated(sourceNodeId, props.position);

      // preventInactivateNodeWhenClickHandle()
    } else {
      if (activatedNode?.HandlePosition === props.position) {
        setHandleActivated(sourceNodeId, null);
        allowInactivateNodeWhenClickOutside();
      } else {
        // console.log(`activate node ${sourceNodeId}, handle ${props.position}, and preventInactivate node ${sourceNodeId}`)
        // activateHandle(sourceNodeId, props.position);
        // preventInactivateNode(sourceNodeId);
        // console.log("activate handle!!", props.position)
        setHandleActivated(sourceNodeId, props.position);
        clearEdgeActivation();
        preventInactivateNode();
      }
    }
    // if (selectedHandle === null) preventActivateNode()
    // else allowActivateNode()
  };

  const showHandleColor = () => {
    // const sourceNode = getNode(sourceNodeId)
    // if (!sourceNode) return ""
    // console.log(sourceNode, "show handle")
    return activatedNode?.id === sourceNodeId &&
      activatedNode?.HandlePosition === props.position
      ? 'selected'
      : '';
  };

  const getHandleStyle = () => {
    switch (props.position) {
      case Position.Top:
        return {
          zIndex: 0,
          top: '-16px', // 向上偏移
          // left: '50%',   // 可以添加水平居中
        };
      case Position.Bottom:
        return {
          zIndex: 0,
          bottom: '-16px', // 向下偏移
        };
      case Position.Left:
        return {
          zIndex: 0,
          left: '-16px', // 向左偏移
        };
      case Position.Right:
        return {
          zIndex: 0,
          right: '-16px', // 向右偏移
        };
      default:
        return {
          zIndex: 0,
        };
    }
  };

  const getHoverPreviewPosition = () => {
    switch (props.position) {
      case Position.Top:
        return 'absolute -top-[344px] -left-[80px]';
      case Position.Right:
        return 'absolute -top-[80px] left-[18px]';
      case Position.Bottom:
        return 'absolute top-[18px] -left-[80px]';
      case Position.Left:
        return 'absolute -top-[80px] -left-[408px]';
      default:
        return '';
    }
  };

  const getArrowRotation = () => {
    switch (props.position) {
      case Position.Top:
        return 'rotate-0';
      case Position.Right:
        return 'rotate-90';
      case Position.Bottom:
        return 'rotate-180';
      case Position.Left:
        return '-rotate-90';
      default:
        return '';
    }
  };

  const getHitAreaClassName = () => {
    switch (props.position) {
      case Position.Left:
      case Position.Right:
        // taller hit area for left/right
        return '!w-[32px] !h-[64px]';
      case Position.Top:
      case Position.Bottom:
        // wider hit area for top/bottom
        return '!w-[64px] !h-[32px]';
      default:
        return '!w-[40px] !h-[40px]';
    }
  };

  return (
    <>
      <Handle
        id={props.id}
        type={props.type}
        position={props.position}
        onClick={event => onClickAction(event)}
        onConnect={(connection: Connection) =>
          console.log(connection.source, connection.sourceHandle)
        }
        style={getHandleStyle()}
        className={`relative flex items-center justify-center z-10 ${judgeDisplay()} ${showHandleColor()} ${getHitAreaClassName()}  !bg-transparent !border-transparent group ${judgeDisplay() === 'transparent' ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'}`}
      >
        {/* inner visible dot (keeps visual small while enlarging transparent hit area) */}
        <div
          className={`pointer-events-none relative z-10 w-[12px] h-[12px] rounded-full border border-[#565656] transition-all duration-150 ease-out group-hover:w-[24px] group-hover:h-[24px] group-hover:border-2 group-hover:border-main-orange ${showHandleColor() === 'selected' ? 'w-[24px] h-[24px] border-2 border-main-orange' : ''}`}
        />
        {/* center arrow icon, visible on hover or when selected */}
        <div
          className={`pointer-events-none absolute inset-0 flex items-center justify-center text-main-orange transition-opacity duration-150 ease-out opacity-0 group-hover:opacity-100 ${showHandleColor() === 'selected' ? 'opacity-100' : ''} ${getArrowRotation()}`}
        >
          <svg
            width='16'
            height='16'
            viewBox='0 0 12 12'
            fill='none'
            xmlns='http://www.w3.org/2000/svg'
          >
            <path
              d='M6 2L6 10M6 2L3 5M6 2L9 5'
              stroke='currentColor'
              strokeWidth='1.5'
              strokeLinecap='round'
              strokeLinejoin='round'
            />
          </svg>
        </div>
      </Handle>
    </>
  );
}

export default WhiteBallHandle;
