import React, {useEffect, useState} from 'react'
import {HandleProps, Handle, Position, Connection, useReactFlow} from '@xyflow/react'
import EdgeMenu1 from '../../menu/edgeMenu/EdgeMenu1'
import { useNodeContext } from '../../states/NodeContext'


type WhiteBallHandleProps = HandleProps & {
    sourceNodeId: string,
    // need a new prop: nodeType
}

type HandleNames = "TopSrcHandle" | "BottomSrcHandle" | "LeftSrcHandle" | "RightSrcHandle";


function WhiteBallHandle({sourceNodeId, ...props}: WhiteBallHandleProps) {

    // console.log(sourceNodeId)
    // design handle bar with multiple handles, must add id for handle
    const {nodes, searchNode, preventActivateNode, allowActivateNode, activateNode, preventInactivateNode, activateHandle, inactivateHandle, allowInactivateNode} = useNodeContext()
    const {getNode} = useReactFlow()

    const handlePositions = {
      [Position.Top]: 'TopSrcHandle',
      [Position.Bottom]: 'BottomSrcHandle',
      [Position.Left]: 'LeftSrcHandle',
      [Position.Right]: 'RightSrcHandle',
    };
    const handleName = handlePositions[props.position] as HandleNames;



    
    function judgeDisplay() {
      let showHandle = false
      const sourceNode = searchNode(sourceNodeId)
      if (!sourceNode) return "transparent"
      showHandle = sourceNode[handleName].isConnected
      


      // if (showHandle && !sourceNode.activated) return ""
      // else if (!showHandle && !sourceNode.activated) return "transparent"
      // else return "active"

      return (sourceNode.activated) ? "active" : "transparent"

    }



    const onClickAction = (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
        event.preventDefault()
        event.stopPropagation()
        console.log(sourceNodeId, props.position)
        // onHandleClick(props.position)
        const sourceNode = searchNode(sourceNodeId)
        if (!sourceNode) return 
        if (!sourceNode.activated) {
          activateNode(sourceNodeId)
          activateHandle(sourceNodeId, props.position)
          preventInactivateNode(sourceNodeId)
        }
        else {
          
          if (handleName) {
            if (sourceNode[handleName].activated) {
              inactivateHandle(sourceNodeId, props.position);
              allowInactivateNode(sourceNodeId);
            } else {
              // console.log(`activate node ${sourceNodeId}, handle ${props.position}, and preventInactivate node ${sourceNodeId}`)
              activateHandle(sourceNodeId, props.position);
              preventInactivateNode(sourceNodeId);
            }
          }
        }
        // if (selectedHandle === null) preventActivateNode()
        // else allowActivateNode()
    }

    const showHandleColor = () => {
      const sourceNode = searchNode(sourceNodeId)
      if (!sourceNode) return ""
      // console.log(sourceNode, "show handle")
      return sourceNode[handleName].activated ? "selected" : ""
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


