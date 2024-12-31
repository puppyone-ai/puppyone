import React, {useState} from 'react'
import NodeSettingsController from './NodeSettingsController'
import FullScreenController from './FullScreenController'
// import { useNodeContext } from '@/app/components/states/NodeContext'
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext'

type NodeToolBarProps = {
    Parentnodeid: string,
    ParentNodetype: string
    
}

function NodeToolBar({Parentnodeid, ParentNodetype}: NodeToolBarProps) {

    const isDisplayFullScreenController = ParentNodetype === "text" || ParentNodetype === "structured" || ParentNodetype === "none"

    const {activatedNode} = useNodesPerFlowContext()
    return (

        <div className={`absolute top-[40px] right-[40px] flex gap-[6.5px] items-center justify-center ${activatedNode?.id === Parentnodeid ? "": "hidden"} p-[1px]`} >
            <NodeSettingsController nodeid={Parentnodeid}/>
            {/* {isDisplayFullScreenController ? <FullScreenController nodeid={Parentnodeid} /> : null} */}
        </div>
    )
}

export default NodeToolBar