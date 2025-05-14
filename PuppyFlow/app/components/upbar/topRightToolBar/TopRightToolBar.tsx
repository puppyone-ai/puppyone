import React from 'react'
import MoreOptionsButton from './MoreOptionsButton'
import ModeController from './ModeControllerButton'
import TestRunBotton from './TestRunBotton'
import { useState, useEffect } from 'react'
import { useNodesPerFlowContext } from "../../states/NodesPerFlowContext"
import SaveButton from './SaveButton'
import DeployBottonNew from './DeployBotton'
import { Controls } from '@xyflow/react'

function TopRightToolBar() {

  // as a menu controller, -1 means no menu is showing, 0 means MoreOptionsButtonMenu is showing, 1 means UploadButtonMenu is showing
  const [showMenu, setShowMenu] = useState(-1)
  const { clearAll, isOnGeneratingNewNode } = useNodesPerFlowContext()

  useEffect(() => {

    // define onClick action and click out action

    const onMouseClick = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const menubuttonContainers = document.getElementsByClassName("TopRightButtonWithMenu") as HTMLCollection
      const target = event.target as HTMLElement
      if (!Array.from(menubuttonContainers).some((buttonContainer: Element) => buttonContainer.contains(target))) {
        setShowMenu(-1)
      }
      else {
        clearAll()
      }
    }

    document.addEventListener('click', onMouseClick)
    return () => document.removeEventListener('click', onMouseClick)
  }, [])

  const showMenuHandler = (menu: number) => {
    setShowMenu(menu)
  }

  return (
    <div className='flex flex-row items-center justify-center gap-[16px] relative pointer-events-auto'>
      <div className='flex items-center '>
        <Controls
          className="react-flow__controls-custom"
          showZoom={true}
          showFitView={true}
          showInteractive={false}
          orientation="horizontal"
          style={{ position: 'relative' }}
        />
      </div>
      <SaveButton />
      <div className={`w-auto h-[36px] border-[1px] border-solid border-[#3E3E41] rounded-[8px] flex flex-row justify-center items-center bg-[#252525]`}>
        <MoreOptionsButton showMenu={showMenu} showMenuHandler={showMenuHandler} />
        <TestRunBotton />
      </div>
      <DeployBottonNew />
    </div>
  )
}

export default TopRightToolBar