import React from 'react'
import MoreOptionsButton from './MoreOptionsButton'
import UploadButton from './UploadButton'
import ModeController from './ModeController'
import StartCodeController from './StartCodeController'
import { useState, useEffect } from 'react'
import { useNodeContext } from "../../states/NodeContext"

function TopRightToolBar() {

  // as a menu controller, -1 means no menu is showing, 0 means MoreOptionsButtonMenu is showing, 1 means UploadButtonMenu is showing
  const [showMenu, setShowMenu] = useState(-1)
  const {clear, activateEdgeNode} = useNodeContext()

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
        clear()
        activateEdgeNode("-1")
      }
    }

    document.addEventListener('click', onMouseClick)
    return () => document.removeEventListener('click', onMouseClick)
  }, [])

  const showMenuHandler = (menu: number) => {
    setShowMenu(menu)
  }

  return (
    <div className='w-auto pl-[10px] pr-[8px] h-[44px] border-[1.5px] border-solid border-[#3E3E41] rounded-[12px] flex flex-row gap-[8px] justify-center items-center bg-[#1C1D1F]'>
        <ModeController />
        <div className='w-[1px] h-[100%] bg-[#3E3E41]'></div>
        <MoreOptionsButton showMenu={showMenu} showMenuHandler={showMenuHandler} />
        <UploadButton showMenu={showMenu} showMenuHandler={showMenuHandler} />
        <StartCodeController />
    </div>
  )
}

export default TopRightToolBar