import React from 'react'
import MoreOptionsButtonMenu from "../../menu/topRightToolBarMenu/MoreOptionsButtonMenu"

type MoreOptionsButtonProps = {
  showMenu: number,
  showMenuHandler: (menu: number) => void
}

function MoreOptionsButton({showMenu,showMenuHandler}: MoreOptionsButtonProps) {
  
  const onManageMenu = () => {
    showMenuHandler(showMenu === 0 ? -1 : 0)
  }

  const clearTopRightToolBarMenu = () => {
    showMenuHandler(-1)
  }
  
  return (
    <div className='relative TopRightButtonWithMenu'>
      <button className={`flex items-center justify-center w-[28px] h-[28px] rounded-[8px] border-[1.5px] border-solid ${showMenu === 0 ? "border-[#CDCDCD]" : "border-[#3E3E41]"} bg-[rgba(217,217,217, 0)] hover:cursor-pointer hover:bg-[#3E3E41]`} onClick={onManageMenu}>
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="3" viewBox="0 0 15 3" fill="none">
        <rect width="3" height="3" fill="#D9D9D9"/>
        <rect x="12" width="3" height="3" fill="#D9D9D9"/>
        <rect x="6" width="3" height="3" fill="#D9D9D9"/>
        </svg>
      </button>
      {showMenu === 0 && (
        <MoreOptionsButtonMenu clearTopRightToolBarMenu={clearTopRightToolBarMenu} />
      )}
    </div>
  )
}

export default MoreOptionsButton