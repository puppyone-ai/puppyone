import React from 'react'
import { Position } from '@xyflow/react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {faGoogle} from '@fortawesome/free-brands-svg-icons'

type SearchSubMenuProps = {
    nodeType: string,
    sourceNodeId: string,
    showMenu: number,
    createNewConnection:(edgeType: string, subMenuType?: string | null) => void,
}

function SearchSubMenu({nodeType, sourceNodeId, showMenu, createNewConnection}: SearchSubMenuProps) {
    
    const topPosition = nodeType === "text" ? "top-[217px]" :
                        nodeType === "structured" ? "top-[262px]" :
                        nodeType === "database" ? "top-[0px]" :
                        nodeType === "vector_database" ? "top-[0px]" :
                        "top-[132px]"

  
                        return (
                            <ul id="edgeMenu" className={`w-[176px] bg-[#1c1d1f] rounded-[16px] border-solid border-[3px] border-[#42454A] absolute float-start flex flex-col justify-evenly z-[20001] ${topPosition} left-[186px] gap-[8px] p-[8px] items-center ${showMenu === 1 ? "" : "hidden"}`} >
                                    <li className='w-full'>
                                        <button className='w-full h-[38px] bg-[#3E3E41] hover:bg-main-orange rounded-[8px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[4px] pl-[4px] cursor-pointer' onClick={(event) => {
                                            event.preventDefault()
                                            event.stopPropagation()
                                            createNewConnection('search', 'search-Vector')
                                        }}>
                                        <div className='w-[30px] h-[30px] bg-[#1C1D1F] flex items-center justify-center rounded-[5px]'>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 14 14">
                                        <path fill="#CDCDCD" d="m0 14 4.597-.446-2.684-3.758L0 14Zm6.768-5.325-4.071 2.907.465.651 4.07-2.908-.465-.65Z"/>
                                        <path stroke="#CDCDCD" strokeWidth="1.5" d="M7 9V2"/>
                                        <path fill="#CDCDCD" d="M7 0 4.69 4h4.62L7 0Z"/>
                                        <path stroke="#CDCDCD" strokeWidth="1.5" d="m7 9-5 3.5"/>
                                        <path fill="#CDCDCD" d="m14 14-4.597-.446 2.684-3.758L14 14ZM7.232 8.675l4.071 2.907-.465.651-4.07-2.908.465-.65Z"/>
                                        <path stroke="#CDCDCD" strokeWidth="1.5" d="m7 9 5 3.5"/>
                                        </svg>
                        
                                        </div>
                                        <div className='text-[14px]  flex items-center justify-center h-full'>By Vector</div>
                                        </button>
                                    </li> 
                                    <li className='w-full'>
                                        <button className='w-full h-[38px] bg-[#3E3E41] hover:bg-main-orange rounded-[8px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[4px] pl-[4px] cursor-pointer' onClick={(event) => {
                                            event.preventDefault()
                                            event.stopPropagation()
                                            createNewConnection('search','search-Perplexity')
                                        }}>
                                            <div className='w-[30px] h-[30px] bg-[#1C1D1F] flex items-center justify-center rounded-[5px]'>
                                            <img src="/Perplexity.svg" alt="Perplexity icon" />
                        
                                            </div>
                                            <div className='text-[14px]  flex items-center justify-center h-full'>Perplexity</div>
                                        </button>
                                    </li> 
                                    <li className='w-full'>
                                        <button className='group w-full h-[38px] bg-[#3E3E41] hover:bg-main-orange rounded-[8px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[4px] pl-[4px] cursor-pointer' onClick={(event) => {
                                            event.preventDefault()
                                            event.stopPropagation()
                                            createNewConnection('search', 'search-Google')
                                        }}>
                                            <div className='w-[30px] h-[30px] bg-[#1C1D1F] flex items-center justify-center rounded-[5px]'>
                                            <FontAwesomeIcon icon={faGoogle} className='text-main-grey'/>
                                            </div>
                                            <div className='text-[14px]  flex items-center justify-center h-full group-hover:text-[#1C1D1F]'>Google</div>
                                        </button>
                                    </li> 
                                    </ul>
                          )
}

export default SearchSubMenu