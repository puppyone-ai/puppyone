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
   
    
    
  return (
    <>
     <Handle 
     id={props.id}
     type={props.type} 
     position={props.position}
     onClick={(event) => onClickAction(event)}
     onConnect={(connection: Connection) => console.log(connection.source, connection.sourceHandle)}
     style={{
       zIndex: 10000,
     }}
    //  onMouseDown={() => preventActivateNode()}
     className={ `relative flex items-center justify-center pb-[5px] ${judgeDisplay()} ${showHandleColor()} transition-all duration-300`} > 
     {showHandleColor() === "selected" && <div className={`text-main-orange transition-all duration-300`}>+</div> } 
    </Handle>
    <EdgeMenu1 nodeType={getNode(sourceNodeId)?.type || "text"} sourceNodeId={sourceNodeId}
        handleId={props.id} position={props.position} />
    </>
    
  )
  
}

export default WhiteBallHandle


