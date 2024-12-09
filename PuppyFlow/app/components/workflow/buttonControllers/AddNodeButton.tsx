'use client'
import React, {useState, useEffect} from 'react'
import {useReactFlow, Node} from '@xyflow/react'
import NodeMenu from '../../menu/nodeMenu/NodeMenu'
import { useNodeContext } from '../../states/NodeContext'

type menuProps = {
    selectedMenu:number,
    setSelectedMenu: React.Dispatch<React.SetStateAction<number>>,
}

function AddNodeButton() {

  const [selectedMenu, setSelectedMenu] = useState(0)
  const {allowActivateNode, addNode, nodes, clear, activateEdgeNode} = useNodeContext()
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
        clear()
        activateEdgeNode("-1")
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
     <button id="nodeMenuButton"  className={`w-[56px] h-[36px] border-[2px] border-[#3E3E41] rounded-[10px]  bg-main-black-theme flex flex-row items-center justify-between px-[8px] cursor-pointer ${selectedMenu === 1 ? "border-[#D9D9D9]" : ""} transition-colors`} >
        <div className='w-[20px] h-[20px] border-[#D9D9D9] border-[1.5px] border-solid flex items-center justify-center rounded-[6px]'>
          <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M4 0L4 8" stroke="#D9D9D9" strokeWidth="1.5"/>
          <path d="M0 4L8 4" stroke="#D9D9D9" strokeWidth="1.5"/>
        </svg>
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" width="8" height="5" viewBox="0 0 8 5" fill="none">
        <path d="M1 1L4 4L7 1" stroke={selectedMenu === 1 ? "#D9D9D9" : "#6D7177"}/>
        </svg>
    </button>
    <NodeMenu selectedMenu={selectedMenu} clearMenu={clearMenu}/>
    </div>
    
  )
}

export default AddNodeButton