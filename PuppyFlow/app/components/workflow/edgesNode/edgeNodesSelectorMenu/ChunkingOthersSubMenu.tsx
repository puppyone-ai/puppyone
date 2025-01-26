import React from 'react'
import { Position } from '@xyflow/react'

type ChunkingOthersSubMenuProps = {
    nodeType: string,
    sourceNodeId: string,
    showMenu: number,
    createNewConnection: (edgeType: string, subMenuType?: string | null) => void,
}

function ChunkingOthersSubMenu({nodeType, sourceNodeId, showMenu, createNewConnection}: ChunkingOthersSubMenuProps) {
    
  
    return (
        <ul id="" className={`w-[176px] bg-[#1c1d1f] rounded-[16px] border-solid border-[3px] border-[#42454A] absolute float-start flex flex-col justify-evenly z-[20001] top-[190px] left-[166px] gap-[8px] p-[8px] items-center ${showMenu === 1 ? "" : "hidden"}`} >
                <li className='w-full'>
                    <button className='w-full h-[38px] bg-[#3E3E41] hover:bg-main-orange rounded-[8px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[4px] pl-[4px] cursor-pointer' onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        createNewConnection('chunk', 'chunk-ForHTML')
                    }}>
                    <div className='w-[30px] h-[30px] bg-[#1C1D1F] flex items-center justify-center rounded-[5px]'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="7" fill="none" viewBox="0 0 17 7">
                    <path fill="#CDCDCD" d="M4.68 1.633v1.09l-3.285 1.16L4.68 5.047v1.086L.078 4.383v-1l4.602-1.75ZM6.45 6 8.68.066h.925L7.367 6H6.45Zm8.269-2.117-3.29-1.16v-1.09l4.602 1.758v.992l-4.601 1.75V5.047l3.289-1.164Z"/>
                    </svg>
                    </div>
                    <div className='text-[14px] font-[500] flex items-center justify-center h-full'>for HTML</div>
                    </button>
                </li> 
                <li className='w-full'>
                    <button className='w-full h-[38px] bg-[#3E3E41] hover:bg-main-orange rounded-[8px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[4px] pl-[4px] cursor-pointer' onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        createNewConnection('chunk', 'chunk-ForMarkdown')
                    }}>
                    <div className='w-[30px] h-[30px] bg-[#1C1D1F] flex items-center justify-center rounded-[5px]'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="10" fill="none" viewBox="0 0 18 10">
                    <path fill="#CDCDCD" d="M2.974 8H1.572V.803H3.76l1.308 5.659 1.3-5.66H8.53V8h-1.4V3.132c0-.14.002-.335.005-.586a49.2 49.2 0 0 0 .005-.586L5.776 8h-1.46L2.964 1.96c0 .137.001.332.005.586.003.25.005.446.005.586V8Z"/>
                    <path stroke="#CDCDCD" strokeWidth="1.5" d="M13.5 1v6m-3-3 3 3 3-3"/>
                    </svg>
                    </div>
                    <div className='text-[14px] font-[500] flex items-center justify-center h-full'>for Markdown</div>
                    </button>
                </li> 
                </ul>
      )
}

export default ChunkingOthersSubMenu