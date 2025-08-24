'use client'
import React, { useState } from 'react';
import ComponentRenderer, { createEmptyElement, useHover, useSelection } from './ComponentRenderer';
import ListActionMenu from './ListActionMenu';
import { useOverflowContext } from './OverflowContext';

type ListComponentProps = {
    data: any[];
    path: string;
    readonly?: boolean;
    isNested?: boolean;
    onUpdate: (newData: any[]) => void;
    onDelete?: () => void;
    parentKey?: string | number;
    preventParentDrag: () => void;
    allowParentDrag: () => void;
    onReplace?: (newValue: any) => void;
}

const ListComponent = ({ 
    data, 
    path = '',
    readonly = false, 
    isNested = false, 
    onUpdate, 
    onDelete,
    preventParentDrag, 
    allowParentDrag,
    onReplace,
}: ListComponentProps) => {
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null); // unused after removing DnD
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null); // unused after removing DnD
    const [showMenu, setShowMenu] = useState(false);
    
    const { hoveredPath, setHoveredPath, isPathHovered } = useHover();

    const deleteItem = (index: number) => {
        const newData = data.filter((_, i) => i !== index);
        onUpdate(newData);
    };

    const addEmptyItem = () => {
        const newData = [...data, createEmptyElement()];
        onUpdate(newData);
    };

    const updateItem = (index: number, newValue: any) => {
        const newData = [...data];
        newData[index] = newValue;
        onUpdate(newData);
    };

    const handleMouseDown = (index: number) => {
        setSelectedIndex(index);
    };

    const handleMouseUp = () => {
        setSelectedIndex(null);
    };


    // Drag-and-drop disabled: remove handlers


    const handleMenuClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setShowMenu(!showMenu);
    };

    const handleCopyList = () => {
        navigator.clipboard.writeText(JSON.stringify(data, null, 2));
        setShowMenu(false);
    };

    const handleClearList = () => {
        // Clear: set the entire list to null (but keep it in parent structure)
        onUpdate(null as any);
        setShowMenu(false);
    };

    const handleDeleteList = () => {
        // Delete: 删除整个列表（包括其在父结构中的键/索引）
        if (onDelete) {
            onDelete();
        } else {
            console.log('Delete list requested but no onDelete callback provided');
        }
        setShowMenu(false);
    };

    // Close menu when clicking outside or mouse leaves
    React.useEffect(() => {
        const handleClickOutside = () => setShowMenu(false);
        if (showMenu) {
            document.addEventListener('click', handleClickOutside);
            return () => document.removeEventListener('click', handleClickOutside);
        }
    }, [showMenu]);

    const handleMenuMouseLeave = () => {
        setShowMenu(false);
    };

    // 构建当前index的完整路径
    const getIndexPath = (index: number) => {
        return path ? `${path}[${index}]` : `[${index}]`;
    };

    // 处理hover事件
    const handleIndexHover = (index: number, isEntering: boolean) => {
        if (isEntering) {
            setHoveredPath(getIndexPath(index));
        } else {
            setHoveredPath(null);
        }
    };


    // Drag-and-drop disabled

    const { isPathSelected, setSelectedPath } = useSelection();
    const [isHovered, setIsHovered] = React.useState(false);
    const isSelected = isPathSelected(path);
    const accentColor = isSelected ? '#E4B66E' : '#D7A85A';
    const [menuOpen, setMenuOpen] = React.useState(false);
    const { registerOverflowElement, unregisterOverflowElement } = useOverflowContext();
    const handleRef = React.useRef<HTMLDivElement | null>(null);

    React.useEffect(() => {
        const menuId = `list-menu-${path}`;
        if (!menuOpen || !handleRef.current) return;

        let rafId: number | null = null;

        const updatePosition = () => {
            if (!handleRef.current) return;
            const rect = handleRef.current.getBoundingClientRect();
            const gap = 8;
            const top = rect.top;
            const left = rect.left - gap;

            registerOverflowElement(
                menuId,
                (
                    <div style={{ position: 'fixed', top, left, transform: 'translateX(-100%)' }}>
                        <ListActionMenu
                            value={data}
                            onClear={() => { onUpdate([]); setMenuOpen(false); }}
                            onTransferToText={() => { onReplace && onReplace(''); setMenuOpen(false); }}
                            onTransferToDict={() => { onReplace && onReplace({ key1: null, key2: null }); setMenuOpen(false); }}
                        />
                    </div>
                ),
                handleRef.current
            );
        };

        const loop = () => {
            updatePosition();
            rafId = requestAnimationFrame(loop);
        };
        loop();

        const onDocClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (handleRef.current && handleRef.current.contains(target)) return;
            if (target.closest('.rjft-action-menu')) return;
            setMenuOpen(false);
        };
        const onScroll = () => updatePosition();
        const onResize = () => updatePosition();
        document.addEventListener('mousedown', onDocClick, true);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onResize);

        return () => {
            if (rafId) cancelAnimationFrame(rafId);
            unregisterOverflowElement(menuId);
            document.removeEventListener('mousedown', onDocClick, true);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onResize);
        };
    }, [menuOpen, data, onUpdate, onReplace, path, registerOverflowElement, unregisterOverflowElement]);

    // Ensure only one menu is open globally
    React.useEffect(() => {
        const onCloseAll = () => setMenuOpen(false);
        window.addEventListener('rjft:close-all-menus', onCloseAll as EventListener);
        return () => window.removeEventListener('rjft:close-all-menus', onCloseAll as EventListener);
    }, []);

    return (
        <div 
            className={`bg-[#252525] shadow-sm relative group group/list p-[2px]`}
            style={{ outline: 'none', boxShadow: isSelected ? 'inset 0 0 0 2px #C18E4C' : 'none' }}
            onClick={(e) => { e.stopPropagation(); setSelectedPath(path); }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <div 
                className="absolute left-0 top-1 bottom-1 w-px bg-[#9A713C] rounded-full z-20"
            >
                {(isSelected || isHovered || menuOpen) && (
                    <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                        <div
                            className="w-4 h-6 bg-[#252525] border-2 rounded-[3px] flex flex-col items-center justify-center gap-0.5 shadow-lg cursor-pointer pointer-events-auto"
                            style={{ borderColor: accentColor }}
                            aria-hidden
                            onClick={(e) => { 
                                e.stopPropagation(); 
                                setSelectedPath(path);
                                if (menuOpen) {
                                    setMenuOpen(false);
                                } else {
                                    window.dispatchEvent(new CustomEvent('rjft:close-all-menus'));
                                    setMenuOpen(true);
                                }
                            }}
                            ref={handleRef}
                        >
                            <div className="w-0.5 h-0.5 rounded-full" style={{ backgroundColor: accentColor }}></div>
                            <div className="w-0.5 h-0.5 rounded-full" style={{ backgroundColor: accentColor }}></div>
                            <div className="w-0.5 h-0.5 rounded-full" style={{ backgroundColor: accentColor }}></div>
                        </div>
                    </div>
                )}
            </div>
            {/* menu rendered via portal */}
            <div 
                className={`space-y-0 transition-all duration-200`}
                
            >
                {data.length === 0 ? (
                    // Empty state - 不显示“click + to add”，仅提示为空
                    <div className="w-full px-[16px] py-[8px] bg-transparent rounded-md overflow-hidden transition-colors duration-200">
                        <div className="flex items-center h-[24px]">
                            <div className="text-[#6D7177] text-[12px] italic leading-normal font-plus-jakarta-sans">
                                empty list
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        {data.map((item, index) => {
                            const indexPath = getIndexPath(index);
                            const isIndexHovered = isPathHovered(indexPath);
                            const showDropIndicator = false; // DnD disabled
                            
                            return (
                                <React.Fragment key={index}>
                                    {/* Drop Indicator Line - Enhanced visual feedback */}
                                    {showDropIndicator && (
                                        <div className="relative">
                                            <div className="absolute inset-x-0 -top-[2px] h-[3px] bg-gradient-to-r from-blue-400 to-blue-500 z-40 rounded-full shadow-lg animate-pulse">
                                                <div className="absolute left-2 -top-1.5 w-3 h-3 bg-blue-400 rounded-full shadow-md"></div>
                                                <div className="absolute right-2 -top-1.5 w-3 h-3 bg-blue-500 rounded-full shadow-md opacity-60"></div>
                                            </div>
                                        </div>
                                    )}
                                    
                                    <div 
                                        className={`group relative transition-all duration-200 ${
                                            showDropIndicator
                                                ? 'bg-blue-400/20 ring-2 ring-blue-400/50'
                                                : isIndexHovered
                                                    ? 'bg-[#CDCDCD]/10'
                                                    : 'hover:bg-[#6D7177]/10'
                                        }`}
                                        onMouseEnter={() => setHoveredPath(indexPath)}
                                        onMouseLeave={() => setHoveredPath(null)}
                                        
                                    >
                                        <div className="flex items-stretch">
                                            {/* Index Badge - display only */}
                                            <div className="flex-shrink-0 flex justify-center">
                                                <div 
                                                    className="relative w-[64px] h-full pt-[4px] bg-[#1C1D1F]/50 overflow-hidden transition-colors duration-200 flex justify-center"
                                                    onMouseEnter={() => handleIndexHover(index, true)}
                                                    onMouseLeave={() => handleIndexHover(index, false)}
                                                >
                                                    <div className="absolute right-0 top-1 bottom-1 w-px bg-[#2A2B2E] z-10 pointer-events-none"></div>
                                                    <span 
                                                        className={`text-[10px] leading-[28px] font-plus-jakarta-sans not-italic inline-block mt-[2px] transition-colors duration-200
                                                            ${isIndexHovered
                                                                ? 'text-[#A8773A]'
                                                                : 'text-[#C18E4C] hover:text-[#D5A262]'
                                                            }`}
                                                    >
                                                        {index}
                                                    </span>
                                                </div>
                                            </div>
                                            
                                            {/* Content */}
                                            <div className="flex-1 min-w-0">
                                                <ComponentRenderer
                                                    data={item}
                                                    path={indexPath}
                                                    readonly={readonly}
                                                    parentKey={index}
                                                    onUpdate={(newValue) => updateItem(index, newValue)}
                                                    onDelete={() => deleteItem(index)}
                                                    preventParentDrag={preventParentDrag}
                                                    allowParentDrag={allowParentDrag}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {/* Drop indicator after last element - Enhanced */}
                                    {index === data.length - 1 && showDropIndicator && (
                                        <div className="relative">
                                            <div className="absolute inset-x-0 top-[2px] h-[3px] bg-gradient-to-r from-blue-400 to-blue-500 z-40 rounded-full shadow-lg animate-pulse">
                                                <div className="absolute left-2 -top-1.5 w-3 h-3 bg-blue-400 rounded-full shadow-md"></div>
                                                <div className="absolute right-2 -top-1.5 w-3 h-3 bg-blue-500 rounded-full shadow-md opacity-60"></div>
                                            </div>
                                        </div>
                                    )}
                                    
                                    {/* Horizontal Divider Line - 在元素之间添加水平分隔线 */}
                                    {index < data.length - 1 && (
                                        <div className="w-full h-[1px] bg-[#6D7177]/70 my-[4px]"></div>
                                    )}
                                </React.Fragment>
                            );
                        })}
                        
                        {/* Items rendered above */}
                    </>
                )}
                {/* Add New Item - 无论空与否都显示底部加号（只读除外） */}
                {!readonly && (
                    <div className="absolute -bottom-3 left-[36px] z-30 transform -translate-x-1/2">
                        <button
                            onClick={addEmptyItem}
                            className="group w-6 h-6 flex items-center justify-center rounded-full 
                                     bg-[#2a2a2a] hover:bg-[#3a3a3a] border border-[#6D7177]/40 hover:border-[#6D7177]/60 
                                     transition-all duration-200 ease-out shadow-lg opacity-0 group-hover/list:opacity-100"
                            title="Add new item"
                        >
                            <svg 
                                className="w-3 h-3 text-[#E5E7EB] transition-transform duration-200 group-hover:scale-110" 
                                viewBox="0 0 16 16" 
                                fill="none" 
                                stroke="currentColor" 
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <path d="M8 3v10M3 8h10" />
                            </svg>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ListComponent; 