import React from 'react'
import { Menu } from '@headlessui/react'
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
    <Menu as="div" className='relative TopRightButtonWithMenu'>
      <Menu.Button className={`group flex items-center justify-center w-[34px] h-[34px] rounded-l-[7px] border-r border-[#3E3E41] bg-[rgba(217,217,217, 0)] hover:cursor-pointer hover:bg-[#3E3E41]`}>
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="3" viewBox="0 0 15 3" fill="none">
          <rect width="3" height="3" className="fill-[#6D7177] group-hover:fill-[#D9D9D9]"/>
          <rect x="12" width="3" height="3" className="fill-[#6D7177] group-hover:fill-[#D9D9D9]"/>
          <rect x="6" width="3" height="3" className="fill-[#6D7177] group-hover:fill-[#D9D9D9]"/>
        </svg>
      </Menu.Button>
      
      <MoreOptionsButtonMenu clearTopRightToolBarMenu={clearTopRightToolBarMenu} />
    </Menu>
  )
}

export default MoreOptionsButton