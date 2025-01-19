import React, {useEffect, useState} from 'react'
import {HandleProps, Handle, Position, Connection, useReactFlow} from '@xyflow/react'
import EdgeMenu1 from '../../menu/edgeMenu/EdgeMenu1'
import { useNodeContext } from '../../states/NodeContext'
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext'


type WhiteBallHandleProps = HandleProps & {
    sourceNodeId: string,
    // need a new prop: nodeType
}

type HandleNames = "TopSrcHandle" | "BottomSrcHandle" | "LeftSrcHandle" | "RightSrcHandle";


function WhiteBallHandle({sourceNodeId, ...props}: WhiteBallHandleProps) {

    // console.log(sourceNodeId)
    // design handle bar with multiple handles, must add id for handle
    // const {nodes, searchNode, preventActivateNode, allowActivateNode, activateNode, preventInactivateNode, activateHandle, inactivateHandle, allowInactivateNode} = useNodeContext()
    const {activatedNode,activateNode, inactivateNode,setHandleActivated, preventInactivateNode, allowInactivateNodeWhenClickOutside, clearAll, clearEdgeActivation} = useNodesPerFlowContext()
    const {getNode} = useReactFlow()

    // const handlePositions = {
    //   [Position.Top]: 'TopSrcHandle',
    //   [Position.Bottom]: 'BottomSrcHandle',
    //   [Position.Left]: 'LeftSrcHandle',
    //   [Position.Right]: 'RightSrcHandle',
    // };
    // const handleName = handlePositions[props.position] as HandleNames;

  

    
    function judgeDisplay() {
      let showHandle = false
      const sourceNode = getNode(sourceNodeId)
      if (!sourceNode) return "transparent"
      // showHandle = sourceNode[handleName].isConnected
      


      // if (showHandle && !sourceNode.activated) return ""
      // else if (!showHandle && !sourceNode.activated) return "transparent"
      // else return "active"

      return (activatedNode?.id === sourceNodeId) ? "active" : "transparent"

    }


    const onClickAction = (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
        event.preventDefault()
        event.stopPropagation()
        console.log(sourceNodeId, props.position)
        // onHandleClick(props.position)
        const sourceNode = getNode(sourceNodeId)
        if (!sourceNode) return 
        if (activatedNode?.id !== sourceNodeId) {
          clearAll()
          // activateNode(sourceNodeId)
          setHandleActivated(sourceNodeId, props.position)
          
          // preventInactivateNodeWhenClickHandle()
        }
        else {
          
            if (activatedNode?.HandlePosition === props.position) {
              setHandleActivated(sourceNodeId, null)
              allowInactivateNodeWhenClickOutside()
            } else {
              // console.log(`activate node ${sourceNodeId}, handle ${props.position}, and preventInactivate node ${sourceNodeId}`)
              // activateHandle(sourceNodeId, props.position);
              // preventInactivateNode(sourceNodeId);
              // console.log("activate handle!!", props.position)
              setHandleActivated(sourceNodeId, props.position)
              clearEdgeActivation()
              preventInactivateNode()
            }
          
        }
        // if (selectedHandle === null) preventActivateNode()
        // else allowActivateNode()
    }

    const showHandleColor = () => {
      // const sourceNode = getNode(sourceNodeId)
      // if (!sourceNode) return ""
      // console.log(sourceNode, "show handle")
      return activatedNode?.id === sourceNodeId && activatedNode?.HandlePosition === props.position ? "selected" : ""
    }
   
    
    const getHandleStyle = () => {
        switch (props.position) {
            case Position.Top:
                return {
                    zIndex: 10000,
                    top: '-16px',    // 向上偏移
                    // left: '50%',   // 可以添加水平居中
                };
            case Position.Bottom:
                return {
                    zIndex: 10000,
                    bottom: '-16px',  // 向下偏移
                };
            case Position.Left:
                return {
                    zIndex: 10000,
                    left: '-16px',    // 向左偏移
                };
            case Position.Right:
                return {
                    zIndex: 10000,
                    right: '-16px',   // 向右偏移
                };
            default:
                return {
                    zIndex: 10000,
                };
        }
    };

    return (
        <>
            <Handle 
                id={props.id}
                type={props.type} 
                position={props.position}
                onClick={(event) => onClickAction(event)}
                onConnect={(connection: Connection) => console.log(connection.source, connection.sourceHandle)}
                style={getHandleStyle()}
                className={`relative flex items-center justify-center ${judgeDisplay()} ${showHandleColor()} transition-all duration-300  hover:!border-main-orange hover:!w-[20px] hover:!h-[20px] hover:!border-2 hover:!rounded-[10px] group`}
            > 
                <div className={`absolute inset-0 flex items-center justify-center text-main-orange transition-all duration-300 opacity-0 group-hover:opacity-100 ${showHandleColor() === "selected" ? "opacity-100" : ""} pointer-events-none`}>
                    <svg 
                        width="10" 
                        height="10" 
                        viewBox="0 0 10 10" 
                        fill="none" 
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        <path 
                            d="M5 0V10M0 5H10" 
                            stroke="currentColor" 
                            strokeWidth="1.5"
                            strokeLinecap="round"
                        />
                    </svg>
                </div>
            </Handle>
            <EdgeMenu1 
                nodeType={getNode(sourceNodeId)?.type || "text"} 
                sourceNodeId={sourceNodeId}
                handleId={props.id} 
                position={props.position} 
            />
        </>
    );
}

export default WhiteBallHandle


