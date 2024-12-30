import React from 'react'
import { Position } from '@xyflow/react'
import ChunkingOthersSubMenu from './ChunkingOthersSubMenu'
import { menuNameType } from './EdgeMenu1'

type ChunkingSubMenuProps = {
    nodeType: string,
    sourceNodeId: string,
    showMenu: number,
    selectedSubMenu: number,
    manageTextNodeSubMenu: (menuName: menuNameType) => void,
    createNewConnection: (edgeType: string, subMenuType?: string | null) => void,
}

function ChunkingSubMenu({nodeType, sourceNodeId, showMenu, selectedSubMenu, manageTextNodeSubMenu, createNewConnection}: ChunkingSubMenuProps) {
    
  
    return (
        <ul id="edgeMenu" className={`w-[176px] bg-[#1c1d1f] rounded-[16px] border-solid border-[3px] border-[#42454A] absolute float-start flex flex-col justify-evenly z-[20001] top-[145px] left-[186px] gap-[8px] p-[8px] items-center ${showMenu === 1 ? "" : "hidden"}`} >
                <li className='w-full'>
                    <button className='w-full h-[38px] bg-[#3E3E41] hover:bg-main-orange rounded-[8px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[4px] pl-[4px] cursor-pointer' 
                    onMouseEnter={() => manageTextNodeSubMenu("Chunkingsub1")}
                    onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        createNewConnection("chunk", "chunk-Auto")
                    }}>
                    <div className='w-[30px] h-[30px] bg-[#1C1D1F] flex items-center justify-center rounded-[5px]'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="15" fill="none" viewBox="0 0 16 15">
                    <path fill="#CDCDCD" d="M1.953.64v.61h-.68v4.292h.68v.612H.483V.641h1.47Zm4.585 3.472h-1.59l-.3.888h-.943L5.246.682h1.02L7.795 5h-.979l-.278-.888Zm-.252-.744L5.747 1.67l-.557 1.7h1.096Zm4.614-.032V.682h.917v2.654c0 .459-.07.816-.213 1.072-.266.469-.773.703-1.521.703-.748 0-1.256-.234-1.523-.703-.143-.256-.214-.613-.214-1.072V.682h.917v2.654c0 .297.035.514.105.65.11.243.348.364.715.364.365 0 .602-.121.712-.364.07-.136.105-.353.105-.65Zm3.812 2.206V1.238h-.68V.641h1.47v5.513h-1.47v-.612h.68ZM2.062 8.641v.609h-.68v4.292h.68v.612H.59V8.641h1.47Zm5.417.04v.765H6.187V13h-.909V9.446H3.98v-.764h3.5Zm2.334 4.44c-.617 0-1.088-.169-1.415-.505-.437-.412-.656-1.006-.656-1.781 0-.791.219-1.385.656-1.781.327-.336.798-.504 1.415-.504.618 0 1.09.168 1.415.504.436.396.654.99.654 1.781 0 .775-.218 1.37-.653 1.781-.327.336-.798.504-1.416.504Zm.853-1.161c.209-.264.313-.639.313-1.125 0-.484-.105-.858-.316-1.122-.209-.266-.492-.399-.85-.399-.357 0-.642.132-.855.396-.213.264-.32.639-.32 1.125s.107.861.32 1.125c.213.264.498.395.855.395.358 0 .642-.131.853-.395Zm3.938 1.582V9.238h-.68v-.597h1.47v5.513h-1.47v-.612h.68Z"/>
                    </svg>
                    </div>
                    <div className='text-[14px]  flex items-center justify-center h-full'>Auto</div>
                    </button>
                </li> 
                <li className='w-full'>
                    <button className='w-full h-[38px] bg-[#3E3E41] hover:bg-main-orange rounded-[8px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[4px] pl-[4px] cursor-pointer' onClick={(event) => {
                    
                        event.preventDefault()
                        event.stopPropagation()
                        createNewConnection("chunk", "chunk-Bylength")
                        // console.warn(position, "this position")
                        // createNewConnection('Load')
                    }}>
                    <div className='w-[30px] h-[30px] bg-[#1C1D1F] flex items-center justify-center rounded-[5px]'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="10" viewBox="0 0 16 10" fill="none">
                    <path d="M10 3L12 5L10 7" stroke="#CDCDCD"/>
                    <path d="M6 3L4 5L6 7" stroke="#CDCDCD"/>
                    <path d="M4 5H11.5" stroke="#CDCDCD"/>
                    <path d="M1 10L1 3.27826e-07" stroke="#CDCDCD" strokeWidth="1.5"/>
                    <path d="M15 10V3.27826e-07" stroke="#CDCDCD" strokeWidth="1.5"/>
                    </svg>
                    </div>
                    <div className='text-[14px]  flex items-center justify-center h-full'>By length</div>
                    </button>
                </li> 
                <li className='w-full'>
                    <button className='w-full h-[38px] bg-[#3E3E41] hover:bg-main-orange rounded-[8px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[4px] pl-[4px] cursor-pointer' 
                     onMouseEnter={() => manageTextNodeSubMenu("Chunkingsub1")}
                    onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        createNewConnection("chunk", "chunk-Bycharacter")
                    }}>
                        <div className='w-[30px] h-[30px] bg-[#1C1D1F] flex items-center justify-center rounded-[5px]'>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="9" fill="none" viewBox="0 0 14 9">
                        <path fill="#CDCDCD" d="m2.816 2.584-.474 4.031h-.873L.982 2.584V.393h1.834v2.191ZM2.77 7.307V9H1.023V7.307H2.77Zm8.789-1.495c-.047.149-.073.38-.077.692H9.9c.024-.66.086-1.115.188-1.365.102-.254.363-.545.785-.873l.428-.334a1.52 1.52 0 0 0 .34-.346 1.18 1.18 0 0 0 .234-.709c0-.297-.088-.566-.264-.809-.171-.246-.488-.369-.949-.369-.453 0-.775.15-.967.451-.187.301-.28.614-.28.938H7.72c.047-1.113.435-1.902 1.166-2.367.46-.297 1.027-.446 1.699-.446.883 0 1.615.211 2.197.633.586.422.88 1.047.88 1.875 0 .508-.128.936-.382 1.283-.148.211-.433.48-.855.809l-.416.322a1.257 1.257 0 0 0-.451.615ZM11.605 9H9.86V7.307h1.746V9Z"/>
                        </svg>
                        </div>
                        <div className='text-[14px]  flex items-center justify-center h-full'>By character</div>
                    </button>
                </li> 
                <li className='w-full'>
                    <button className='w-full h-[38px] bg-[#3E3E41] hover:bg-main-orange rounded-[8px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[4px] pl-[4px] cursor-pointer' 
                     onMouseEnter={() => manageTextNodeSubMenu("Chunkingsub1")}
                    onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        createNewConnection("chunk", "chunk-ByLLM")
                    }}>
                        <div className='w-[30px] h-[30px] bg-[#1C1D1F] flex items-center justify-center rounded-[5px]'>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 14 14">
                        <g clipPath="url(#a)">
                            <mask id="b" width="14" height="14" x="0" y="0" maskUnits="userSpaceOnUse" style={{maskType:"luminance"}}>
                            <path fill="#fff" d="M14 0H0v14h14V0Z"/>
                            </mask>
                            <g mask="url(#b)">
                            <path fill="#CDCDCD" d="M12.996 5.73a3.488 3.488 0 0 0-.3-2.865 3.527 3.527 0 0 0-3.798-1.692A3.489 3.489 0 0 0 6.267 0a3.528 3.528 0 0 0-3.365 2.442A3.49 3.49 0 0 0 .57 4.134a3.528 3.528 0 0 0 .434 4.136 3.487 3.487 0 0 0 .3 2.865 3.527 3.527 0 0 0 3.799 1.692A3.486 3.486 0 0 0 7.733 14a3.528 3.528 0 0 0 3.367-2.444 3.49 3.49 0 0 0 2.332-1.692 3.529 3.529 0 0 0-.435-4.135v.001Zm-5.262 7.355a2.615 2.615 0 0 1-1.68-.607c.022-.012.06-.032.083-.047l2.788-1.61a.453.453 0 0 0 .23-.397v-3.93l1.178.68a.041.041 0 0 1 .022.033v3.254a2.627 2.627 0 0 1-2.62 2.624Zm-5.637-2.408a2.613 2.613 0 0 1-.312-1.758l.082.05 2.788 1.61a.454.454 0 0 0 .458 0l3.403-1.965v1.36a.043.043 0 0 1-.016.037l-2.818 1.627a2.627 2.627 0 0 1-3.584-.96Zm-.733-6.085c.306-.532.79-.939 1.365-1.15l-.001.096v3.22a.454.454 0 0 0 .229.397L6.36 9.12l-1.178.68a.042.042 0 0 1-.04.004L2.324 8.175a2.627 2.627 0 0 1-.96-3.583Zm9.68 2.253L7.64 4.88l1.178-.68a.042.042 0 0 1 .04-.004l2.818 1.627a2.624 2.624 0 0 1-.405 4.735V7.24a.453.453 0 0 0-.228-.396Zm1.172-1.765a3.875 3.875 0 0 0-.082-.05L9.346 3.42a.454.454 0 0 0-.458 0L5.485 5.386v-1.36a.043.043 0 0 1 .016-.037L8.32 2.363a2.623 2.623 0 0 1 3.896 2.717h.001ZM4.844 7.505l-1.179-.68a.041.041 0 0 1-.022-.033V3.538a2.624 2.624 0 0 1 4.303-2.015 1.955 1.955 0 0 0-.083.046L5.075 3.18a.453.453 0 0 0-.23.397v3.928Zm.64-1.38L7 5.25l1.516.875v1.75L7 8.75l-1.516-.875v-1.75Z"/>
                            </g>
                        </g>
                        <defs>
                            <clipPath id="a">
                            <path fill="#fff" d="M0 0h14v14H0z"/>
                            </clipPath>
                        </defs>
                        </svg>
    
                        </div>
                        <div className='text-[14px]  flex items-center justify-center h-full'>By LLM</div>
                    </button>
                </li> 
                <li className='w-full'>
                    <button className={`w-full h-[38px] ${selectedSubMenu === 3 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[8px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans py-[4px] pl-[4px] cursor-pointer`} 
                    onMouseEnter={() => manageTextNodeSubMenu("ChunkingOtherssub2")}>
    
                    <div className='flex items-center gap-[11px] flex-1'>
                        <div className='w-[30px] h-[30px] bg-[#1C1D1F] flex items-center justify-center rounded-[5px]'>
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="6" fill="none" viewBox="0 0 10 6">
                        <path fill="#D9D9D9" d="M0 0h2v2H0zm4 0h2v2H4zm4 0h2v2H8zM0 4h2v2H0zm4 0h2v2H4zm4 0h2v2H8z"/>
                        </svg>
                        </div>
                        <div className='text-[14px]  flex items-center justify-center h-full'>Others</div>
                    </div>
                    <div className='h-full w-[7px] flex items-center justify-center mr-[9px]'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="7" height="10" viewBox="0 0 7 10" fill="none">
                    <path d="M1 1L5 5L1 9" stroke={selectedSubMenu === 3? "#1C1D1F":"#CDCDCD"} strokeWidth="2"/>
                    </svg>
                    </div>
                    </button>
                    <ChunkingOthersSubMenu nodeType={nodeType} sourceNodeId={sourceNodeId} showMenu={selectedSubMenu === 3 ? 1 : 0} createNewConnection={createNewConnection} />
                </li> 
                </ul>
      )
}

export default ChunkingSubMenu