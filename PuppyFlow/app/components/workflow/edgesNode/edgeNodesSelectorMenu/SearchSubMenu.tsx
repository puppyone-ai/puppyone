import React from 'react'
import { Position } from '@xyflow/react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faGoogle } from '@fortawesome/free-brands-svg-icons'

type SearchSubMenuProps = {
    nodeType: string,
    sourceNodeId: string,
    showMenu: number,
    createNewConnection: (edgeType: string, subMenuType?: string | null) => void,
    parentMenuRef?: React.RefObject<HTMLDivElement>,
}

function SearchSubMenu({ nodeType, sourceNodeId, showMenu, createNewConnection, parentMenuRef }: SearchSubMenuProps) {

    return (
        <ul id="edgeMenu" className={`w-[176px] bg-[#1c1d1f] rounded-[16px] border-solid border-[3px] border-[#42454A] absolute flex flex-col justify-evenly z-[20001] gap-[8px] p-[8px] items-center ${showMenu === 1 ? "" : "hidden"}`}
            style={{
                position: 'absolute',
                top: '-12px',
                left: '100%', // 直接放在父元素右侧
                marginLeft: '7px' // 添加一些间距
            }}
        >

            <li className='w-full'>
                <button className='w-full h-[38px] bg-[#3E3E41] hover:bg-main-orange rounded-[8px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[4px] pl-[4px] cursor-pointer' onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    createNewConnection('search', 'search-Perplexity')
                }}>
                    <div className='w-[30px] h-[30px] bg-[#1C1D1F] flex items-center justify-center rounded-[5px]'>
                        <img src="/Perplexity.svg" alt="Perplexity icon" />
                    </div>
                    <div className='text-[14px]  flex items-center justify-center h-full'>Perplexity</div>
                </button>
            </li>
            {/*
            <li className='w-full'>
                <button className='w-full h-[38px] bg-[#3E3E41] hover:bg-main-orange rounded-[8px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[4px] pl-[4px] cursor-pointer' onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    createNewConnection('searchPerplexity','search-Perplexity')
                }}>
                    <div className='w-[30px] h-[30px] bg-[#1C1D1F] flex items-center justify-center rounded-[5px]'>
                    <img src="/Perplexity.svg" alt="Perplexity icon" />
                    </div>
                    <div className='text-[14px]  flex items-center justify-center h-full'>Perplexity</div>
                </button>
            </li> */}

            <li className='w-full'>
                <button className='group w-full h-[38px] bg-[#3E3E41] hover:bg-main-orange rounded-[8px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[4px] pl-[4px] cursor-pointer' onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    createNewConnection('search', 'search-Google')
                }}>
                    <div className='w-[30px] h-[30px] bg-[#1C1D1F] flex items-center justify-center rounded-[5px]'>
                        <FontAwesomeIcon icon={faGoogle} className='text-main-grey' />
                    </div>
                    <div className='text-[14px]  flex items-center justify-center h-full group-hover:text-[#1C1D1F]'>Google</div>
                </button>
            </li>
            {/*
            <li className='w-full'>
                <button className='group w-full h-[38px] bg-[#3E3E41] hover:bg-main-orange rounded-[8px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[4px] pl-[4px] cursor-pointer' onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    createNewConnection('searchGoogle', 'search-Google')
                }}>
                    <div className='w-[30px] h-[30px] bg-[#1C1D1F] flex items-center justify-center rounded-[5px]'>
                    <FontAwesomeIcon icon={faGoogle} className='text-main-grey'/>
                    </div>
                    <div className='text-[14px]  flex items-center justify-center h-full group-hover:text-[#1C1D1F]'>Google</div>
                </button>
            </li>
             */}
        </ul>
    )
}

export default SearchSubMenu