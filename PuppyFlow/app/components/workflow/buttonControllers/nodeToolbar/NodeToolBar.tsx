import React, {useState} from 'react'
import NodeSettingsController from './NodeSettingsController'
import FullScreenController from './FullScreenController'
import { useNodeContext } from '@/app/components/states/NodeContext'

type NodeToolBarProps = {
    Parentnodeid: string,
    ParentNodetype: string
    
}

function NodeToolBar({Parentnodeid, ParentNodetype}: NodeToolBarProps) {

    const isDisplayFullScreenController = ParentNodetype === "text" || ParentNodetype === "structured" || ParentNodetype === "none"

    const {searchNode} = useNodeContext()
    return (

        <div className={`absolute top-[40px] right-[40px] flex gap-[6.5px] items-center justify-center ${searchNode(Parentnodeid)?.activated ? "": "hidden"} p-[1px]`} >
            <NodeSettingsController nodeid={Parentnodeid}/>
            {/* {isDisplayFullScreenController ? <FullScreenController nodeid={Parentnodeid} /> : null} */}
        </div>
    )
}

export default NodeToolBar