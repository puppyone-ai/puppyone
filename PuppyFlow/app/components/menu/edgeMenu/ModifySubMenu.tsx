import React from 'react'
import { Position } from '@xyflow/react'
import { menuNameType } from './EdgeMenu1'
type ModifySubMenuProps = {
    nodeType: string,
    sourceNodeId: string,
    showMenu: number,
    createNewConnection: (edgeType: string, subMenuType?: string | null) => void,
}

function ModifySubMenu({nodeType, sourceNodeId, showMenu, createNewConnection}: ModifySubMenuProps) {
    
  
  return (
    <ul id="edgeMenu" className={`bg-[#1c1d1f] rounded-[8px] border-solid border-[3px] border-[#42454A] absolute float-start flex flex-col justify-evenly z-[20001] top-[50px] left-[135px] gap-[3px] p-[3px] items-center ${showMenu === 1 ? "" : "hidden"}`} >
            <li>
                <button className='w-[116px] h-[30px] bg-[#3E3E41] hover:bg-main-orange rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[3px] pl-[3px] cursor-pointer' onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    createNewConnection('modify', 'modify-copy')
                }}>
                <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="13" viewBox="0 0 12 13" fill="none">
                <rect x="3.75" y="0.75" width="7.5" height="7.5" stroke="#CDCDCD" strokeWidth="1.5"/>
                <rect x="0.75" y="4.75" width="7.5" height="7.5" fill="#1C1D1F" stroke="#CDCDCD" strokeWidth="1.5"/>
                </svg>
                </div>
                <div className='text-[12px] font-[700] flex items-center justify-center h-full'>copy</div>
                </button>
            </li> 
            <li>
                <button className='w-[116px] h-[30px] bg-[#3E3E41] hover:bg-main-orange rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[3px] pl-[3px] cursor-pointer' onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    createNewConnection('modify', 'modify-get')
                }}>
                <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M10.5 7.00016C4.08333 7.00016 3.5 2.3335 3.5 2.3335" stroke="#CDCDCD" strokeWidth="1.5"/>
                <rect x="-0.75" y="0.75" width="3.5" height="3.5" transform="matrix(-1 0 0 1 3.5 0)" fill="#1C1D1F" stroke="#CDCDCD" strokeWidth="1.5"/>
                <path d="M13.25 5.25H9.75V8.75H13.25V5.25Z" fill="#1C1D1F" stroke="#CDCDCD" strokeWidth="1.5"/>
                <rect x="-0.75" y="0.75" width="3.5" height="3.5" transform="matrix(-1 0 0 1 3.5 9)" fill="#1C1D1F" stroke="#CDCDCD" strokeWidth="1.5"/>
                </svg>
                </div>
                <div className='text-[12px] font-[700] flex items-center justify-center h-full'>get</div>
                </button>
            </li> 
            <li>
                <button className='w-[116px] h-[30px] bg-[#3E3E41] hover:bg-main-orange rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[3px] pl-[3px] cursor-pointer' onClick={(event) => {
                
                    event.preventDefault()
                    event.stopPropagation()
                    createNewConnection('modify', 'modify-text')
                }}>
                <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px] text-[10px] font-[400 text-main-grey'>
                    Aa
                </div>
                <div className='text-[12px] font-[700] flex items-center justify-center h-full'>text</div>
                </button>
            </li> 
            <li >
                <button className='w-[116px] h-[30px] bg-[#3E3E41] hover:bg-main-orange rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[3px] pl-[3px] cursor-pointer' onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    createNewConnection('modify', 'modify-structured')
                }}>
                    <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px] text-[10px] font-[400] text-main-grey'>
                    {"{Aa}"}
                    </div>
                    <div className='text-[12px] font-[700] flex items-center justify-center h-full'>structured</div>
                </button>
            </li> 
            </ul>
  )
}

export default ModifySubMenu