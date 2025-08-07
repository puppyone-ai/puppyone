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
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
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

    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        
        // 创建自定义拖拽预览
        const dragPreview = createDragPreview(index, data[index]);
        document.body.appendChild(dragPreview);
        
        // 设置拖拽镜像
        e.dataTransfer.setDragImage(dragPreview, 10, 10);
        
        // 延迟移除预览元素
        setTimeout(() => {
            if (document.body.contains(dragPreview)) {
                document.body.removeChild(dragPreview);
            }
        }, 0);
        
        // 防止父级拖拽
        preventParentDrag();
        setHoveredPath(getIndexPath(index));
    };

    // 创建拖拽预览元素
    const createDragPreview = (index: number, value: any) => {
        const preview = document.createElement('div');
        preview.style.cssText = `
            position: absolute;
            top: -1000px;
            left: -1000px;
            background: #1a1a1a;
            border: 1px solid #444;
            border-radius: 8px;
            padding: 8px 12px;
            font-family: 'Plus Jakarta Sans', sans-serif;
            font-size: 12px;
            color: #CDCDCD;
            max-width: 200px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 1000;
            pointer-events: none;
        `;
        
        // 创建index部分
        const indexSpan = document.createElement('span');
        indexSpan.style.cssText = `
            color: #ff9b4d;
            font-style: italic;
            margin-right: 8px;
        `;
        indexSpan.textContent = `[${index}]`;
        
        // 创建分隔符
        const separator = document.createElement('span');
        separator.style.cssText = `
            color: #6D7177;
            margin-right: 8px;
        `;
        separator.textContent = ':';
        
        // 创建值预览部分
        const valueSpan = document.createElement('span');
        valueSpan.style.cssText = `
            color: #CDCDCD;
            opacity: 0.8;
        `;
        
        // 根据值类型显示不同的预览
        let valuePreview = '';
        if (typeof value === 'string') {
            valuePreview = value.length > 20 ? `"${value.substring(0, 20)}..."` : `"${value}"`;
        } else if (Array.isArray(value)) {
            valuePreview = `[${value.length} items]`;
        } else if (typeof value === 'object' && value !== null) {
            const keys = Object.keys(value);
            valuePreview = `{${keys.length} keys}`;
        } else {
            valuePreview = String(value);
        }
        
        valueSpan.textContent = valuePreview;
        
        preview.appendChild(indexSpan);
        preview.appendChild(separator);
        preview.appendChild(valueSpan);
        
        return preview;
    };

    const handleDragEnd = () => {
        setDraggedIndex(null);
        setDragOverIndex(null);
        setSelectedIndex(null);
        // 恢复父级拖拽
        allowParentDrag();
    };

    const handleDragOver = (e: React.DragEvent, index: number, position: 'before' | 'after') => {
        e.preventDefault();
        e.stopPropagation();
        
        // Check if this is a valid drop target - accept both internal and external drags
        if (draggedItem === null && draggedIndex === null) return;
        
        e.dataTransfer.dropEffect = 'move';
        setDragOverIndex(index);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        // Only clear if we're actually leaving the component
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragOverIndex(null);
        }
    };

    const handleDrop = (e: React.DragEvent, dropIndex: number) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Handle internal reordering (dragging within same list)
        if (draggedIndex !== null && draggedItem === null) {
            if (draggedIndex === dropIndex) {
                return; // Dropping on same position
            }

            const newData = [...data];
            const item = newData[draggedIndex];
            
            // Remove from old position
            newData.splice(draggedIndex, 1);
            
            // Insert at new position
            const insertIndex = draggedIndex < dropIndex ? dropIndex - 1 : dropIndex;
            newData.splice(insertIndex, 0, item);
            
            onUpdate(newData);
            setDraggedIndex(null);
            setDragOverIndex(null);
            return;
        }
        
        // Handle external drops (from global drag context)
        if (draggedItem !== null) {
            console.log('List - External drop:', { 
                draggedItem, 
                dropIndex, 
                draggedPath, 
                draggedKey, 
                draggedParentType,
                hasSourceOnDelete: !!sourceOnDelete
            });
            
            // Call source delete callback to remove from original location
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
        }
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

    // 新增：处理单个项目的拖动开始
    const handleItemDragStart = (e: React.DragEvent, index: number) => {
        e.stopPropagation();
        // Set the dragged item in global context with delete callback
        const deleteCallback = () => {
            const newData = data.filter((_, i) => i !== index);
            onUpdate(newData);
        };
        setDraggedItem(data[index], getIndexPath(index), index, 'list', deleteCallback);
        e.dataTransfer.effectAllowed = 'move';
        
        // Visual feedback
        const dragPreview = createItemDragPreview(data[index]);
        document.body.appendChild(dragPreview);
        e.dataTransfer.setDragImage(dragPreview, 10, 10);
        
        setTimeout(() => {
            if (document.body.contains(dragPreview)) {
                document.body.removeChild(dragPreview);
            }
        }, 0);
        
        preventParentDrag();
        setHoveredPath(getIndexPath(index));
    };

    // 新增：创建项目的拖动预览
    const createItemDragPreview = (value: any) => {
        const preview = document.createElement('div');
        preview.style.cssText = `
            position: absolute;
            top: -1000px;
            left: -1000px;
            background: #1a1a1a;
            border: 1px solid #444;
            border-radius: 8px;
            padding: 8px 12px;
            font-family: 'Plus Jakarta Sans', sans-serif;
            font-size: 12px;
            color: #CDCDCD;
            max-width: 200px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 1000;
            pointer-events: none;
        `;
        
        const valueSpan = document.createElement('span');
        valueSpan.style.cssText = `
            color: #CDCDCD;
            opacity: 0.8;
        `;
        
        let valuePreview = '';
        if (typeof value === 'string') {
            valuePreview = value.length > 30 ? `"${value.substring(0, 30)}..."` : `"${value}"`;
        } else if (Array.isArray(value)) {
            valuePreview = `[${value.length} items]`;
        } else if (typeof value === 'object' && value !== null) {
            const keys = Object.keys(value);
            valuePreview = `{${keys.length} keys}`;
        } else {
            valuePreview = String(value);
        }
        
        valueSpan.textContent = valuePreview;
        preview.appendChild(valueSpan);
        
        return preview;
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
        <div className="bg-[#252525] shadow-sm group/list relative">
            <div className="absolute left-0 top-1 bottom-1 w-[2px] bg-[#ff9b4d] rounded-full">
                <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#ff9b4d] rounded-full transition-all duration-200 group-hover/list:w-[4px] group-hover/list:left-[-1px]"></div>
                <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover/list:opacity-100 transition-opacity duration-200 z-50">
                    <button
                        onClick={handleMenuClick}
                        className="w-4 h-6 bg-[#252525] border border-[#ff9b4d]/50 rounded-[3px] flex flex-col items-center justify-center gap-0.5 shadow-lg hover:bg-[#2a2a2a] transition-colors duration-200 cursor-move"
                        title={isNested ? "List options - drag to move entire list" : "List options"}
                        draggable={!readonly && isNested}
                        onDragStart={(e) => {
                            if (!readonly && isNested && onDelete) {
                                e.stopPropagation();
                                // Drag the entire list component with delete callback
                                setDraggedItem(data, path, data.length, 'list', onDelete);
                                e.dataTransfer.effectAllowed = 'move';
                                preventParentDrag();
                            }
                        }}
                        onDragEnd={handleDragEnd}
                    >
                        <div className="w-0.5 h-0.5 bg-[#ff9b4d] rounded-full"></div>
                        <div className="w-0.5 h-0.5 bg-[#ff9b4d] rounded-full"></div>
                        <div className="w-0.5 h-0.5 bg-[#ff9b4d] rounded-full"></div>
                    </button>
                    
                    {/* Menu for list */}
                    {showMenu && (
                        <div 
                            className="absolute left-6 top-0 w-[128px] bg-[#252525] p-[8px] border-[1px] border-[#404040] rounded-[8px] gap-[4px] flex flex-col shadow-2xl"
                            style={{ zIndex: 9999999 }}
                            onMouseLeave={handleMenuMouseLeave}
                        >
                            <button
                                onClick={handleCopyList}
                                className="px-[0px] rounded-[4px] bg-inherit hover:bg-[#3E3E41] w-full h-[26px] flex justify-start items-center text-[#CDCDCD] hover:text-white font-plus-jakarta-sans text-[12px] font-[400] tracking-[0.5px] cursor-pointer whitespace-nowrap gap-[8px]"
                            >
                                <div className="flex justify-center items-center">
                                    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M8 6H16C16.5523 6 17 6.44772 17 7V15C17 15.5523 16.5523 16 16 16H8C7.44772 16 7 15.5523 7 15V7C7 6.44772 7.44772 6 8 6Z" stroke="#BEBEBE" strokeWidth="1.5" fill="none"/>
                                        <path d="M10 4H18C18.5523 4 19 4.44772 19 5V13" stroke="#BEBEBE" strokeWidth="1.5" fill="none"/>
                                    </svg>
                                </div>
                                Copy
                            </button>
                            
                            <button
                                onClick={handleClearList}
                                className="px-[0px] rounded-[4px] bg-inherit hover:bg-[#3E3E41] w-full h-[26px] flex justify-start items-center text-[#F44336] hover:text-[#FF6B64] font-plus-jakarta-sans text-[12px] font-[400] tracking-[0.5px] cursor-pointer whitespace-nowrap gap-[8px]"
                            >
                                <div className="flex justify-center items-center">
                                    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <rect x="7" y="9" width="12" height="10" rx="1" stroke="#F44336" strokeWidth="1.5"/>
                                        <path d="M10 6H16" stroke="#F44336" strokeWidth="1.5" strokeLinecap="round"/>
                                        <path d="M8 9H18" stroke="#F44336" strokeWidth="1.5" strokeLinecap="round"/>
                                        <path d="M11 12V16" stroke="#F44336" strokeWidth="1.5" strokeLinecap="round"/>
                                        <path d="M15 12V16" stroke="#F44336" strokeWidth="1.5" strokeLinecap="round"/>
                                    </svg>
                                </div>
                                Clear
                            </button>
                        </div>
                    )}
                </div>
            </div>
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
                            const isDraggedOrSelected = selectedIndex === index || draggedIndex === index;
                            
                            return (
                                <React.Fragment key={index}>
                                    {/* Drop Indicator Line - Enhanced visual feedback */}
                                    {dragOverIndex === index && (draggedIndex !== null || draggedItem !== null) && draggedIndex !== index && (
                                        <div className="relative">
                                            <div className="absolute inset-x-0 -top-[2px] h-[3px] bg-gradient-to-r from-blue-400 to-blue-500 z-40 rounded-full shadow-lg animate-pulse">
                                                <div className="absolute left-2 -top-1.5 w-3 h-3 bg-blue-400 rounded-full shadow-md"></div>
                                                <div className="absolute right-2 -top-1.5 w-3 h-3 bg-blue-500 rounded-full shadow-md opacity-60"></div>
                                            </div>
                                        </div>
                                    )}
                                    
                                    <div 
                                        className={`group relative transition-all duration-200 ${
                                            isDraggedOrSelected
                                                ? 'bg-blue-500/30 opacity-50' 
                                                : dragOverIndex === index && (draggedIndex !== null || draggedItem !== null)
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
                                            {/* Index Badge - draggable to move item */}
                                            <div className="flex-shrink-0 flex justify-center">
                                                <div 
                                                    className={`w-[64px] pt-[4px] bg-transparent rounded-md overflow-hidden transition-colors duration-200 flex justify-center
                                                        ${!readonly ? 'cursor-move active:cursor-grabbing' : ''}`}
                                                    draggable={!readonly}
                                                    onMouseDown={() => {
                                                        if (!readonly) {
                                                            handleMouseDown(index);
                                                            setHoveredPath(indexPath);
                                                        }
                                                    }}
                                                    onMouseUp={() => !readonly && handleMouseUp()}
                                                    onDragStart={(e) => {
                                                        if (!readonly) {
                                                            // Use cross-container drag for external moves
                                                            handleItemDragStart(e, index);
                                                            setHoveredPath(indexPath);
                                                        }
                                                    }}
                                                    onDragEnd={() => {
                                                        if (!readonly) {
                                                            handleDragEnd();
                                                            setHoveredPath(null);
                                                        }
                                                    }}
                                                    onMouseEnter={() => handleIndexHover(index, true)}
                                                    onMouseLeave={() => handleIndexHover(index, false)}
                                                    title="Drag to move this item"
                                                >
                                                    <span 
                                                        className={`text-[10px] leading-[28px] font-plus-jakarta-sans italic transition-colors duration-200
                                                            ${isDraggedOrSelected
                                                                ? 'text-blue-300' 
                                                                : isIndexHovered
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
                                    {index === data.length - 1 && dragOverIndex === index && (draggedIndex !== null || draggedItem !== null) && draggedIndex !== index && (
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