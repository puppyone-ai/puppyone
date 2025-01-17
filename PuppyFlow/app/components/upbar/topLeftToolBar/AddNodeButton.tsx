'use client'
import React, {useState, useEffect} from 'react'
import {useReactFlow, Node} from '@xyflow/react'
import NodeMenu from '../../menu/nodeMenu/NodeMenu'
// import { useNodeContext } from '../../states/NodeContext'
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext'

type menuProps = {
    selectedMenu:number,
    setSelectedMenu: React.Dispatch<React.SetStateAction<number>>,
}

function AddNodeButton() {

  const [selectedMenu, setSelectedMenu] = useState(0)
  // const {allowActivateNode, addNode, nodes, clear, activateEdgeNode} = useNodeContext()
  const {allowActivateOtherNodesWhenConnectEnd, clearAll, isOnGeneratingNewNode} = useNodesPerFlowContext()
  const {setNodes, getNodes} = useReactFlow()

  useEffect(() => {

    // define onClick action and click out action

    const onMouseClick = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const menubuttonContainer = document.getElementById("nodeMenuButtonContainer") as HTMLButtonElement
      const menubutton = document.getElementById("nodeMenuButton") as HTMLButtonElement
      const target = event.target as HTMLElement
      if (!menubuttonContainer.contains(target)) {
        setSelectedMenu(0)
        // setSelectedMenu(prev => prev === 0 ? 1 : 0)
        // allowActivateNode()
        // clear()
      }
      else if (menubutton.contains(target)){
        setSelectedMenu(prev => prev === 0 ? 1 : 0)
        clearAll()
        // activateEdgeNode("-1")
      }

    }

    document.addEventListener('click', onMouseClick)
    return () => document.removeEventListener('click', onMouseClick)
  }, [])


  const clearMenu = () => {
    setSelectedMenu(0)
  }

  // const onMenuButtonClick = (nodeType: string) => {

  //   const location = Math.random() * 500
  //   setNodes(prevNodes => {
  //     const newId = `${prevNodes.length + 1}`
  //     // addNode(newId)
  //     return [...prevNodes, {
  //       id: newId,
  //       position: {x: location, y:location},
  //       data: {textContent: " "},
  //       type: nodeType,
  //     }]
  //   })
  // allowActivateNode()
  // }



    
  return (
    <div id="nodeMenuButtonContainer">
     <button id="nodeMenuButton"  className={`w-[44px] h-[44px] rounded-full  flex flex-row items-center justify-center cursor-pointer ${selectedMenu === 1 ? "bg-[#CDCDCD]" : "bg-main-blue"} transition-colors ${isOnGeneratingNewNode ? "pointer-events-none" : "pointer-events-auto"}`} >
     <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 8 8" fill="none">
          <path d="M4 0L4 8" stroke="#181818" strokeWidth="1.5"/>
          <path d="M0 4L8 4" stroke="#181818" strokeWidth="1.5"/>
        </svg>
    </button>
    <NodeMenu selectedMenu={selectedMenu} clearMenu={clearMenu}/>
    </div>
    
  )
}

export default AddNodeButton