import React, {useState, memo} from 'react'
import NodeSettingsController from './NodeSettingsButton'
import FullScreenController from './FullScreenButton'
// import { useNodeContext } from '@/app/components/states/NodeContext'
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext'

type NodeToolBarProps = {
    Parentnodeid: string,
    ParentNodetype: string
    
}

const NodeToolBar = memo(function NodeToolBar({Parentnodeid, ParentNodetype}: NodeToolBarProps) {

    const isDisplayFullScreenController = ParentNodetype === "text" || ParentNodetype === "structured" || ParentNodetype === "none"

    const {activatedNode} = useNodesPerFlowContext()
    return (

        <div className={`flex gap-[6.5px] items-center justify-start ${activatedNode?.id === Parentnodeid ? "": "hidden"} p-[1px] z-[100]`} >
            <NodeSettingsController nodeid={Parentnodeid}/>
            {/* {isDisplayFullScreenController ? <FullScreenController nodeid={Parentnodeid} /> : null} */}
        </div>
    )
})

export default NodeToolBar