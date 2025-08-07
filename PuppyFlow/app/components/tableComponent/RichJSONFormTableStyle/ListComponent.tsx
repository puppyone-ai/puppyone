'use client'
import React, { useState } from 'react';
import ComponentRenderer, { createEmptyElement, useHover, useDrag } from './ComponentRenderer';

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
}

const ListComponent = ({ 
    data, 
    path = '',
    readonly = false, 
    isNested = false, 
    onUpdate, 
    onDelete,
    preventParentDrag, 
    allowParentDrag 
}: ListComponentProps) => {
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    const [showMenu, setShowMenu] = useState(false);
    
    const { hoveredPath, setHoveredPath, isPathHovered } = useHover();
    const { draggedItem, draggedPath, draggedKey, draggedParentType, sourceOnDelete, setDraggedItem, clearDraggedItem } = useDrag();

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


    const handleDragEnd = () => {
        setDragOverIndex(null);
        setSelectedIndex(null);
        // 恢复父级拖拽
        allowParentDrag();
    };

    // Handle drag over for component reordering within list
    const handleDragOver = (e: React.DragEvent, index: number, position: 'before' | 'after') => {
        e.preventDefault();
        e.stopPropagation();
        
        // Check if this is a valid drop target for component dragging
        if (draggedItem === null) return;
        
        e.dataTransfer.dropEffect = 'move';
        setDragOverIndex(index);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        // Only clear if we're actually leaving the component
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragOverIndex(null);
        }
    };

    // Handle drop for component reordering within list
    const handleDrop = (e: React.DragEvent, dropIndex: number) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (draggedItem === null) return;
        
        console.log('List - Dropping component:', { 
            draggedItem, 
            dropIndex, 
            draggedPath, 
            draggedKey, 
            draggedParentType,
            hasSourceOnDelete: !!sourceOnDelete
        });
        
        // Handle internal reordering (dragging within same list)
        const isSameList = draggedPath === path || (draggedPath && path && draggedPath.startsWith(path + '['));
        console.log('List - isSameList check:', { 
            isSameList, 
            draggedPath, 
            currentPath: path
        });
        
        if (isSameList && typeof draggedKey === 'number') {
            // Internal reordering
            const newData = [...data];
            const item = newData[draggedKey];
            
            // Remove from old position
            newData.splice(draggedKey, 1);
            
            // Insert at new position
            const insertIndex = draggedKey < dropIndex ? dropIndex - 1 : dropIndex;
            newData.splice(insertIndex, 0, item);
            
            onUpdate(newData);
            clearDraggedItem();
            setDragOverIndex(null);
            return;
        }
        
        // Handle external drops (from global drag context)
        if (sourceOnDelete) {
            sourceOnDelete();
            console.log('Called source delete callback for external drop to list');
        }
        
        // Insert the dragged item at the specified position
        const newData = [...data];
        newData.splice(dropIndex, 0, draggedItem);
        
        onUpdate(newData);
        clearDraggedItem();
        setDragOverIndex(null);
    };


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


    // Handle dropping on empty list
    const handleEmptyDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (draggedItem === null || data.length > 0) return;
        
        console.log('List - Empty drop:', { 
            draggedItem, 
            draggedPath, 
            draggedKey, 
            draggedParentType,
            hasSourceOnDelete: !!sourceOnDelete
        });
        
        // Always call source delete for empty drop - we're moving the item here
        if (sourceOnDelete) {
            sourceOnDelete();
            console.log('Called source delete callback for empty drop to list');
        }
        
        // Add the dragged item to the empty list
        onUpdate([draggedItem]);
        clearDraggedItem();
    };

    return (
        <div className="bg-[#252525] shadow-sm relative">
            <div className="absolute left-0 top-1 bottom-1 w-[2px] bg-[#ff9b4d] rounded-full"></div>
            <div 
                className={`space-y-0 transition-all duration-200 ${
                    data.length === 0 && draggedItem !== null 
                        ? 'bg-blue-400/10 border-2 border-dashed border-blue-400/50 rounded-md p-2' 
                        : ''
                }`}
                onDragOver={(e) => {
                    if (data.length === 0 && draggedItem !== null) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                    }
                }}
                onDragEnter={(e) => {
                    if (data.length === 0 && draggedItem !== null) {
                        e.preventDefault();
                    }
                }}
                onDrop={handleEmptyDrop}
            >
                {data.length === 0 ? (
                    // Empty state - 简洁版本
                    <div className="w-full px-[16px] py-[8px] bg-transparent rounded-md overflow-hidden transition-colors duration-200">
                        {readonly ? (
                            <div className="flex items-center h-[24px]">
                                <div className="text-[#6D7177] text-[12px] italic leading-normal font-plus-jakarta-sans">
                                    empty list
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center h-[24px] space-x-2">
                                <span className="text-[#6D7177] text-[12px] italic leading-normal font-plus-jakarta-sans">
                                    empty list, click
                                </span>
                                <button
                                    onClick={addEmptyItem}
                                    className="flex items-center justify-center w-6 h-5 bg-[#2a2a2a] hover:bg-[#3a3a3a] border border-[#6D7177]/30 hover:border-[#6D7177]/50 rounded-md text-[#CDCDCD] hover:text-white transition-all duration-200"
                                    title="Add first item"
                                >
                                    <svg 
                                        className="w-3 h-3" 
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
                                <span className="text-[#6D7177] text-[12px] italic leading-normal font-plus-jakarta-sans">
                                    to add
                                </span>
                            </div>
                        )}
                    </div>
                ) : (
                    <>
                        {data.map((item, index) => {
                            const indexPath = getIndexPath(index);
                            const isIndexHovered = isPathHovered(indexPath);
                            const showDropIndicator = dragOverIndex === index && draggedItem !== null;
                            
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
                                        onDragOver={(e) => {
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const midpoint = rect.top + rect.height / 2;
                                            const position = e.clientY < midpoint ? 'before' : 'after';
                                            handleDragOver(e, index, position);
                                        }}
                                        onDragLeave={handleDragLeave}
                                        onDrop={(e) => handleDrop(e, index)}
                                    >
                                        <div className="flex items-stretch">
                                            {/* Index Badge - display only */}
                                            <div className="flex-shrink-0 flex justify-center">
                                                <div 
                                                    className="w-[64px] pt-[4px] bg-transparent rounded-md overflow-hidden transition-colors duration-200 flex justify-center"
                                                    onMouseEnter={() => handleIndexHover(index, true)}
                                                    onMouseLeave={() => handleIndexHover(index, false)}
                                                >
                                                    <span 
                                                        className={`text-[10px] leading-[28px] font-plus-jakarta-sans italic transition-colors duration-200
                                                            ${isIndexHovered
                                                                ? 'text-[#cc9968]'
                                                                : 'text-[#ff9b4d] hover:text-[#ffb366]'
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
                                                    onUpdate={(newValue) => updateItem(index, newValue)}
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
                        
                        {/* Add New Item - 只在非空时显示 */}
                        {!readonly && (
                            <div className="absolute -bottom-2 left-[32px] z-30 transform -translate-x-1/2">
                                <button
                                    onClick={addEmptyItem}
                                    className="group w-6 h-4 flex items-center justify-center rounded-[3px] 
                                             bg-[#252525] hover:bg-[#2a2a2a] border border-[#6D7177]/30 hover:border-[#6D7177]/50 
                                             transition-all duration-200 ease-out shadow-lg opacity-0 group-hover/list:opacity-100"
                                    title="Add new item"
                                >
                                    <svg 
                                        className="w-3 h-2.5 text-[#CDCDCD] transition-transform duration-200 group-hover:scale-110" 
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
                    </>
                )}
            </div>
        </div>
    );
};

export default ListComponent; 