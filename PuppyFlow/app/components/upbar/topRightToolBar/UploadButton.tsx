import React from 'react'
import UploadButtonMenu from '../../menu/topRightToolBarMenu/UploadButtonMenu'

type UploadButtonProps = {
  showMenu: number,
  showMenuHandler: (menu: number) => void
}

function UploadButton({showMenu, showMenuHandler}: UploadButtonProps) {

  const onManageMenu = () => {
    showMenuHandler(showMenu === 1 ? -1 : 1)
  }

  const clearTopRightToolBarMenu = () => {
    showMenuHandler(-1)
  }

  return (
    <div className='relative TopRightButtonWithMenu'>
      <button className={`flex items-center justify-center w-[28px] h-[28px] rounded-[8px] border-[1.5px] border-solid ${showMenu === 1 ? "border-[#CDCDCD]" : "border-[#3E3E41]"} bg-[rgba(217,217,217, 0)] hover:cursor-pointer hover:bg-[#3E3E41]`} onClick={onManageMenu}>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 10 11" fill="none">
        <path d="M1 5V10H9V5" stroke="#D9D9D9" strokeWidth="1.5"/>
        <path d="M5 7.5L5 2" stroke="#D9D9D9" strokeWidth="1.5"/>
        <path d="M5 0L2.6906 4L7.3094 4L5 0ZM5.4 6V3.6H4.6V6H5.4Z" fill="#D9D9D9"/>
        </svg>
    </button>
    {showMenu === 1 && (
      <UploadButtonMenu clearTopRightToolBarMenu={clearTopRightToolBarMenu} />
    )}
    </div>
  )
}

export default UploadButton