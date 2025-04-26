'use client';

// import { useNodeContext } from '@/app/components/states/NodeContext'
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext'
import React, { useState, useRef, useEffect } from 'react'
import { useReactFlow } from '@xyflow/react'
import { VectorIndexingItem, IndexingItem } from '../JsonNodeNew'
import IndexingMenu from './NodeIndexingMenu'

type NodeIndexingButtonProps = {
    nodeid: string,
    indexingList: IndexingItem[],
    onAddIndex: (newItem: IndexingItem) => void,
    onRemoveIndex: (index: number) => void
}

function NodeIndexingButton({ nodeid, indexingList, onAddIndex, onRemoveIndex }: NodeIndexingButtonProps) {
    const [isHovered, setHovered] = useState(false)
    const [showMenu, setShowMenu] = useState(false)
    const indexButtonRef = useRef<HTMLButtonElement | null>(null)
    const componentRef = useRef<HTMLDivElement | null>(null)
    const menuRef = useRef<HTMLDivElement | null>(null)
    
    const { activatedNode, setHandleActivated } = useNodesPerFlowContext()
    const { getNode } = useReactFlow()

    // 鼠标悬浮效果
    const onMouseEnter = () => {
        setHovered(true)
    }

    const onMouseLeave = () => {
        setHovered(false)
    }

    // 点击按钮处理
    const handleIndexClick = () => {
        const target = getNode(nodeid)
        if (target) {
            setHandleActivated(nodeid, null)
            setShowMenu(!showMenu)
        }
    }

    // 关闭菜单
    const handleCloseMenu = () => {
        setShowMenu(false)
    }

    // 添加点击外部关闭菜单的逻辑 - 修改后，不再在事件委托上处理，而是使用mousedown/mouseup组合
    useEffect(() => {
        if (!showMenu) return;

        let isClickInsideMenu = false;
        let isClickInsideButton = false;

        // 使用mousedown和mouseup事件组合来准确判断点击位置
        const handleMouseDown = (e: MouseEvent) => {
            const targetElement = e.target as HTMLElement;
            
            // 检查是否点击在菜单内部
            if (menuRef.current?.contains(targetElement) || 
                targetElement.closest('.indexing-menu-container')) {
                isClickInsideMenu = true;
            } else {
                isClickInsideMenu = false;
            }
            
            // 检查是否点击在按钮上
            if (componentRef.current?.contains(targetElement)) {
                isClickInsideButton = true;
            } else {
                isClickInsideButton = false;
            }
        };

        const handleMouseUp = (e: MouseEvent) => {
            // 如果既不是点击在菜单内部，也不是点击在按钮上，则关闭菜单
            if (!isClickInsideMenu && !isClickInsideButton) {
                setShowMenu(false);
            }
        };

        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [showMenu]);

    // 当节点不再激活时关闭菜单
    useEffect(() => {
        if (activatedNode?.id !== nodeid) {
            setShowMenu(false)
        }
    }, [activatedNode?.id, nodeid])

    // 设置悬浮效果对应的颜色
    const fillColor = isHovered ? "#BEBEBE" : "#6D7177"

    return (
        <div ref={componentRef} style={{ position: 'relative', isolation: 'isolate' }} className='indexing-button-container'>
            <button 
                ref={indexButtonRef} 
                className={`flex items-center justify-center ${isHovered || showMenu ? "bg-[#3E3E41]" : ""} w-[24px] h-[24px] rounded-[8px]`} 
                onMouseEnter={onMouseEnter} 
                onMouseLeave={onMouseLeave} 
                onClick={handleIndexClick}
                title="Manage Indexing"
            >
                {/* 索引图标 - 使用不同于设置按钮的图标 */}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect 
                        x="2.75" 
                        y="1.75" 
                        width="10.5" 
                        height="12.5" 
                        rx="2.25" 
                        stroke={indexingList.length > 0 ? "#39BC66" : fillColor} 
                        strokeWidth="1.5"
                    />
                    <path 
                        d="M3 6H12.5" 
                        stroke={indexingList.length > 0 ? "#39BC66" : fillColor} 
                        strokeWidth="1.5"
                    />
                    <path 
                        d="M3 10H13" 
                        stroke={indexingList.length > 0 ? "#39BC66" : fillColor} 
                        strokeWidth="1.5"
                    />
                    <path 
                        d="M4.5 3.5H5.5V4.5H4.5V3.5Z" 
                        fill={indexingList.length > 0 ? "#39BC66" : fillColor}
                    />
                    <path 
                        d="M4.5 7.5H5.5V8.5H4.5V7.5Z" 
                        fill={indexingList.length > 0 ? "#39BC66" : fillColor}
                    />
                    <path 
                        d="M4.5 11.5H5.5V12.5H4.5V11.5Z" 
                        fill={indexingList.length > 0 ? "#39BC66" : fillColor}
                    />
                </svg>
            </button>

            {/* 使用固定定位确保菜单显示在其他元素之上 */}
            <div ref={menuRef} style={{ position: 'fixed', zIndex: 20000 }} className="indexing-menu-container">
                {showMenu && (
                    <IndexingMenu
                        id={nodeid}
                        showMenu={showMenu}
                        indexingList={indexingList}
                        onClose={handleCloseMenu}
                        onAddIndex={onAddIndex}
                        onRemoveIndex={onRemoveIndex}
                    />
                )}
            </div>
        </div>
    )
}

export default NodeIndexingButton