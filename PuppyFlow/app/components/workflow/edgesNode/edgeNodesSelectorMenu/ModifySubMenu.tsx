import React from 'react'
import { Position } from '@xyflow/react'
import { menuNameType } from './EdgeSelectorMenu'
type ModifySubMenuProps = {
    nodeType: string,
    sourceNodeId: string,
    showMenu: number,
    createNewConnection: (edgeType: string, subMenuType?: string | null) => void,
}

function ModifySubMenu({ nodeType, sourceNodeId, showMenu, createNewConnection }: ModifySubMenuProps) {

    //display different menus for text and structured
    return <>
        {
            nodeType == "text" ? <ul id="edgeMenu" className={`w-[176px] bg-[#1c1d1f] rounded-[16px] border-solid border-[3px] border-[#42454A] absolute float-start flex flex-col justify-evenly z-[20001] top-[100px] left-[186px] gap-[8px] p-[8px] items-center ${showMenu === 1 ? "" : "hidden"}`} >
                <li className='w-full'>
                    <button className='w-full h-[38px] bg-[#3E3E41] hover:bg-main-orange rounded-[8px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[4px] pl-[4px] cursor-pointer' onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        createNewConnection('modify', 'modify-copy')
                    }}>
                        <div className='w-[30px] h-[30px] bg-[#1C1D1F] flex items-center justify-center rounded-[5px]'>
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none">
                                <path d="M8 1H2C1.45 1 1 1.45 1 2V8" stroke="#CDCDCD" strokeWidth="1.5" strokeLinecap="round" />
                                <rect x="4" y="4" width="7" height="7" rx="1" stroke="#CDCDCD" strokeWidth="1.5" />
                            </svg>
                        </div>
                        <div className='text-[14px] flex items-center justify-center h-full'>Copy</div>
                    </button>
                </li>
                <li className='w-full'>
                    <button className='w-full h-[38px] bg-[#3E3E41] hover:bg-main-orange rounded-[8px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[4px] pl-[4px] cursor-pointer' onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        createNewConnection('modify', 'modify-convert2structured')
                    }}>
                        <div className='w-[30px] h-[30px] bg-[#1C1D1F] flex items-center justify-center rounded-[5px]'>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="none">
                                <path d="M12 2L2 12" stroke="#CDCDCD" strokeWidth="1.5" />
                                <path d="M12 2L8 2" stroke="#CDCDCD" strokeWidth="1.5" />
                                <path d="M12 2L12 6" stroke="#CDCDCD" strokeWidth="1.5" />
                                <path d="M2 12L6 12" stroke="#CDCDCD" strokeWidth="1.5" />
                                <path d="M2 12L2 8" stroke="#CDCDCD" strokeWidth="1.5" />
                            </svg>
                        </div>
                        <div className='text-[14px] flex items-center justify-center h-full'>Convert</div>
                    </button>
                </li>
                <li className='w-full'>
                    <button className='w-full h-[38px] bg-[#3E3E41] hover:bg-main-orange rounded-[8px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[4px] pl-[4px] cursor-pointer' onClick={(event) => {

                        event.preventDefault()
                        event.stopPropagation()
                        createNewConnection('modify', 'modify-text')
                    }}>
                        <div className='w-[30px] h-[30px] bg-[#1C1D1F] flex items-center justify-center rounded-[5px] text-[10px] font-[400] text-main-grey'>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="none">
                                <path d="M8.5 2.5L11.5 5.5L5 12H2V9L8.5 2.5Z" stroke="#CDCDCD" strokeWidth="1.5" />
                                <path d="M8.5 2.5L9.5 1.5L12.5 4.5L11.5 5.5" stroke="#CDCDCD" strokeWidth="1.5" />
                            </svg>
                        </div>
                        <div className='text-[14px]  flex items-center justify-center h-full'>Edit</div>
                    </button>
                </li>
            </ul>
                :
                <ul id="edgeMenu" className={`w-[176px] bg-[#1c1d1f] rounded-[16px] border-solid border-[3px] border-[#42454A] absolute float-start flex flex-col justify-evenly z-[20001] top-[100px] left-[186px] gap-[8px] p-[8px] items-center ${showMenu === 1 ? "" : "hidden"}`} >
                    <li className='w-full'>
                        <button className='w-full h-[38px] bg-[#3E3E41] hover:bg-main-orange rounded-[8px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[4px] pl-[4px] cursor-pointer' onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            createNewConnection('modify', 'modify-copy')
                        }}>
                            <div className='w-[30px] h-[30px] bg-[#1C1D1F] flex items-center justify-center rounded-[5px]'>
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none">
                                    <path d="M8 1H2C1.45 1 1 1.45 1 2V8" stroke="#CDCDCD" strokeWidth="1.5" strokeLinecap="round" />
                                    <rect x="4" y="4" width="7" height="7" rx="1" stroke="#CDCDCD" strokeWidth="1.5" />
                                </svg>
                            </div>
                            <div className='text-[14px] flex items-center justify-center h-full'>Copy</div>
                        </button>
                    </li>
                    <li className='w-full'>
                        <button className='w-full h-[38px] bg-[#3E3E41] hover:bg-main-orange rounded-[8px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[4px] pl-[4px] cursor-pointer' onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            createNewConnection('modify', 'modify-convert2text')
                        }}>
                            <div className='w-[30px] h-[30px] bg-[#1C1D1F] flex items-center justify-center rounded-[5px]'>
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="none">
                                    <path d="M12 2L2 12" stroke="#CDCDCD" strokeWidth="1.5" />
                                    <path d="M12 2L8 2" stroke="#CDCDCD" strokeWidth="1.5" />
                                    <path d="M12 2L12 6" stroke="#CDCDCD" strokeWidth="1.5" />
                                    <path d="M2 12L6 12" stroke="#CDCDCD" strokeWidth="1.5" />
                                    <path d="M2 12L2 8" stroke="#CDCDCD" strokeWidth="1.5" />
                                </svg>
                            </div>
                            <div className='text-[14px] flex items-center justify-center h-full'>Convert</div>
                        </button>
                    </li>
                    <li className='w-full'>
                        <button className='w-full h-[38px] bg-[#3E3E41] hover:bg-main-orange rounded-[8px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[4px] pl-[4px] cursor-pointer' onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            createNewConnection('modify', 'modify-get')
                        }}>
                            <div className='w-[30px] h-[30px] bg-[#1C1D1F] flex items-center justify-center rounded-[5px]'>
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="none">
                                    <path d="M8.5 2.5L11.5 5.5L5 12H2V9L8.5 2.5Z" stroke="#CDCDCD" strokeWidth="1.5" />
                                    <path d="M8.5 2.5L9.5 1.5L12.5 4.5L11.5 5.5" stroke="#CDCDCD" strokeWidth="1.5" />
                                </svg>
                            </div>
                            <div className='text-[14px]  flex items-center justify-center h-full'>Edit</div>
                        </button>
                    </li>

                </ul>

        }
    </>
}

export default ModifySubMenu