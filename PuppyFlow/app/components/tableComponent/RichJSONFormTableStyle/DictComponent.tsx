'use client'
import React, { useState } from 'react';
import ComponentRenderer, { createEmptyElement, useHover } from './ComponentRenderer';

type DictComponentProps = {
    data: Record<string, any>;
    path: string;
    readonly?: boolean;
    isNested?: boolean;
    onUpdate: (newData: Record<string, any>) => void;
    onDelete?: () => void; // 新增：删除整个对象的回调
    preventParentDrag: () => void;
    allowParentDrag: () => void;
}

const DictComponent = ({ 
    data, 
    path = '',
    readonly = false, 
    isNested = false, 
    onUpdate, 
    onDelete,
    preventParentDrag, 
    allowParentDrag 
}: DictComponentProps) => {
    const [draggedKey, setDraggedKey] = useState<string | null>(null);
    const [dragOverKey, setDragOverKey] = useState<string | null>(null);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [showMenu, setShowMenu] = useState(false);
    
    const { hoveredPath, setHoveredPath, isPathHovered } = useHover();

    const keys = Object.keys(data);

    const deleteKey = (keyToDelete: string) => {
        const newData = { ...data };
        delete newData[keyToDelete];
        onUpdate(newData);
    };

    // 生成随机key的函数
    const generateRandomKey = () => {
        const existingKeys = Object.keys(data);
        let newKey = `${Math.random().toString(36).substr(2, 6)}`;
        
        // 确保key不重复
        while (existingKeys.includes(newKey)) {
            newKey = `${Math.random().toString(36).substr(2, 6)}`;
        }
        
        return newKey;
    };

    const addEmptyKey = () => {
        const newKey = generateRandomKey();
        const newData = {
            ...data,
            [newKey]: createEmptyElement()
        };
        onUpdate(newData);
    };

    const updateValue = (key: string, newValue: any) => {
        const newData = {
            ...data,
            [key]: newValue
        };
        onUpdate(newData);
    };

    const handleMouseDown = (key: string) => {
        setSelectedKey(key);
    };

    const handleMouseUp = () => {
        setSelectedKey(null);
    };

    const handleDragStart = (e: React.DragEvent, key: string) => {
        setDraggedKey(key);
        e.dataTransfer.effectAllowed = 'move';
        
        // 创建自定义拖拽预览
        const dragPreview = createDragPreview(key, data[key]);
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
        setHoveredPath(getKeyPath(key));
    };

    // 创建拖拽预览元素
    const createDragPreview = (key: string, value: any) => {
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
        
        // 创建key部分
        const keySpan = document.createElement('span');
        keySpan.style.cssText = `
            color: #9b7edb;
            font-style: italic;
            margin-right: 8px;
        `;
        keySpan.textContent = key;
        
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
        
        preview.appendChild(keySpan);
        preview.appendChild(separator);
        preview.appendChild(valueSpan);
        
        return preview;
    };

    const handleDragEnd = () => {
        setDraggedKey(null);
        setDragOverKey(null);
        setSelectedKey(null);
        // 恢复父级拖拽
        allowParentDrag();
    };

    const handleDragOver = (e: React.DragEvent, key: string) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverKey(key);
    };

    const handleDragLeave = () => {
        setDragOverKey(null);
    };

    const handleDrop = (e: React.DragEvent, dropKey: string) => {
        e.preventDefault();
        
        if (draggedKey === null || draggedKey === dropKey) {
            return;
        }

        // 重新排序键值对
        const keyArray = Object.keys(data);
        const draggedIndex = keyArray.indexOf(draggedKey);
        const dropIndex = keyArray.indexOf(dropKey);
        
        // 移除被拖拽的键
        keyArray.splice(draggedIndex, 1);
        
        // 插入到新位置
        const insertIndex = draggedIndex < dropIndex ? dropIndex - 1 : dropIndex;
        keyArray.splice(insertIndex, 0, draggedKey);
        
        // 重建对象，保持新的键顺序
        const newData: Record<string, any> = {};
        keyArray.forEach(key => {
            newData[key] = data[key];
        });
        
        onUpdate(newData);
        setDraggedKey(null);
        setDragOverKey(null);
    };

    // 构建当前key的完整路径
    const getKeyPath = (key: string) => {
        return path ? `${path}.${key}` : key;
    };

    // 处理hover事件
    const handleKeyHover = (key: string, isEntering: boolean) => {
        if (isEntering) {
            setHoveredPath(getKeyPath(key));
        } else {
            setHoveredPath(null);
        }
    };

    const handleMenuClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setShowMenu(!showMenu);
    };

    const handleCopyObject = () => {
        navigator.clipboard.writeText(JSON.stringify(data, null, 2));
        setShowMenu(false);
    };

    const handleClearObject = () => {
        // Clear: set the entire object to null (but keep it in parent structure)
        onUpdate(null as any);
        setShowMenu(false);
    };

    const handleDeleteObject = () => {
        // Delete: 删除整个对象（包括其在父结构中的键/索引）
        if (onDelete) {
            onDelete();
        } else {
            console.log('Delete object requested but no onDelete callback provided');
        }
        setShowMenu(false);
    };

    const handleClearAll = () => {
        // Clear all keys: make it an empty object
        onUpdate({});
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

    return (
        <div className="bg-[#252525] shadow-sm group/dict relative">
            <div className="absolute left-0 top-1 bottom-1 w-[2px] bg-[#9b7edb] rounded-full">
                <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#9b7edb] rounded-full transition-all duration-200 group-hover/dict:w-[4px] group-hover/dict:left-[-1px]"></div>
                <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover/dict:opacity-100 transition-opacity duration-200 z-50">
                    <button
                        onClick={handleMenuClick}
                        className="w-4 h-6 bg-[#252525] border border-[#9b7edb]/50 rounded-[3px] flex flex-col items-center justify-center gap-0.5 shadow-lg hover:bg-[#2a2a2a] transition-colors duration-200"
                        title="Object options"
                    >
                        <div className="w-0.5 h-0.5 bg-[#9b7edb] rounded-full"></div>
                        <div className="w-0.5 h-0.5 bg-[#9b7edb] rounded-full"></div>
                        <div className="w-0.5 h-0.5 bg-[#9b7edb] rounded-full"></div>
                    </button>
                    
                    {/* Menu for dict */}
                    {showMenu && (
                        <div 
                            className="absolute left-6 top-0 w-[128px] bg-[#252525] p-[8px] border-[1px] border-[#404040] rounded-[8px] gap-[4px] flex flex-col shadow-2xl"
                            style={{ zIndex: 9999999 }}
                            onMouseLeave={handleMenuMouseLeave}
                        >
                            <button
                                onClick={handleCopyObject}
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
                                onClick={handleClearObject}
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
            <div className="space-y-0">
                {keys.length === 0 ? (
                    // Empty state - 简洁版本
                    <div className="w-full px-[16px] py-[8px] bg-transparent rounded-md overflow-hidden transition-colors duration-200">
                        {readonly ? (
                            <div className="flex items-center h-[24px]">
                                <div className="text-[#6D7177] text-[12px] italic leading-normal font-plus-jakarta-sans">
                                    empty object
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center h-[24px] space-x-2">
                                <span className="text-[#6D7177] text-[12px] italic leading-normal font-plus-jakarta-sans">
                                    empty object, click
                                </span>
                                <button
                                    onClick={addEmptyKey}
                                    className="flex items-center justify-center w-6 h-5 bg-[#2a2a2a] hover:bg-[#3a3a3a] border border-[#6D7177]/30 hover:border-[#6D7177]/50 rounded-md text-[#CDCDCD] hover:text-white transition-all duration-200"
                                    title="Add first key"
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
                        {keys.map((key, index) => {
                            const keyPath = getKeyPath(key);
                            const isKeyHovered = isPathHovered(keyPath);
                            const isDraggedOrSelected = selectedKey === key || draggedKey === key;
                            
                            return (
                                <React.Fragment key={key}>
                                    {/* Drop Indicator Line - 在当前元素上方显示插入指示线 */}
                                    {dragOverKey === key && draggedKey !== null && draggedKey !== key && (
                                        <div className="relative">
                                            <div className="absolute inset-x-0 -top-[2px] h-[2px] bg-blue-400 z-40 rounded-full shadow-lg">
                                                <div className="absolute left-2 -top-1 w-2 h-2 bg-blue-400 rounded-full"></div>
                                            </div>
                                        </div>
                                    )}
                                    
                                    <div 
                                        className={`group relative transition-all duration-200 ${
                                            isDraggedOrSelected
                                                ? 'bg-blue-500/30' 
                                                : isKeyHovered 
                                                    ? 'bg-[#CDCDCD]/10' 
                                                    : 'hover:bg-[#6D7177]/10'
                                        }`}
                                        onDragOver={(e) => handleDragOver(e, key)}
                                        onDragLeave={handleDragLeave}
                                        onDrop={(e) => handleDrop(e, key)}
                                    >
                                        <div className="flex items-stretch">
                                            {/* Key Badge - 现在可直接拖拽 */}
                                            <div className="flex-shrink-0 flex justify-center">
                                                <div 
                                                    className={`w-[64px] pt-[4px] bg-transparent rounded-md overflow-hidden transition-colors duration-200 flex justify-center
                                                        ${!readonly ? 'cursor-pointer active:cursor-grabbing' : ''}`}
                                                    draggable={!readonly}
                                                    onMouseDown={() => {
                                                        if (!readonly) {
                                                            handleMouseDown(key);
                                                            setHoveredPath(keyPath); // 拖拽时也设置hover路径
                                                        }
                                                    }}
                                                    onMouseUp={() => !readonly && handleMouseUp()}
                                                    onDragStart={(e) => {
                                                        if (!readonly) {
                                                            handleDragStart(e, key);
                                                            setHoveredPath(keyPath); // 拖拽开始时设置hover路径
                                                        }
                                                    }}
                                                    onDragEnd={() => {
                                                        if (!readonly) {
                                                            handleDragEnd();
                                                            setHoveredPath(null); // 拖拽结束时清除hover路径
                                                        }
                                                    }}
                                                    onMouseEnter={() => handleKeyHover(key, true)}
                                                    onMouseLeave={() => handleKeyHover(key, false)}
                                                >
                                                    <span 
                                                        className={`text-[10px] leading-[28px] font-plus-jakarta-sans truncate max-w-full italic transition-colors duration-200
                                                            ${isDraggedOrSelected
                                                                ? 'text-blue-300' 
                                                                : isKeyHovered
                                                                    ? 'text-[#a68bc7]'
                                                                    : 'text-[#9b7edb] hover:text-[#b194e8]'
                                                            }`}
                                                        title={key}
                                                    >
                                                        {key}
                                                    </span>
                                                </div>
                                            </div>
                                            
                                            {/* Content */}
                                            <div className="flex-1 min-w-0">
                                                <ComponentRenderer
                                                    data={data[key]}
                                                    path={keyPath}
                                                    readonly={readonly}
                                                    onUpdate={(newValue) => updateValue(key, newValue)}
                                                    preventParentDrag={preventParentDrag}
                                                    allowParentDrag={allowParentDrag}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {/* 最后一个元素后的插入指示线 */}
                                    {index === keys.length - 1 && dragOverKey === key && draggedKey !== null && draggedKey !== key && (
                                        <div className="relative">
                                            <div className="absolute inset-x-0 top-[2px] h-[2px] bg-blue-400 z-40 rounded-full shadow-lg">
                                                <div className="absolute left-2 -top-1 w-2 h-2 bg-blue-400 rounded-full"></div>
                                            </div>
                                        </div>
                                    )}
                                    
                                    {/* Horizontal Divider Line - 在元素之间添加水平分隔线 */}
                                    {index < keys.length - 1 && (
                                        <div className="w-full h-[1px] bg-[#6D7177]/70 my-[4px]"></div>
                                    )}
                                </React.Fragment>
                            );
                        })}
                        
                        {/* Add New Key - 只在非空时显示 */}
                        {!readonly && (
                            <div className="absolute -bottom-2 left-[32px] z-30 transform -translate-x-1/2">
                                <button
                                    onClick={addEmptyKey}
                                    className="group w-6 h-4 flex items-center justify-center rounded-[3px] 
                                             bg-[#252525] hover:bg-[#2a2a2a] border border-[#6D7177]/30 hover:border-[#6D7177]/50 
                                             transition-all duration-200 ease-out shadow-lg opacity-0 group-hover/dict:opacity-100"
                                    title="Add new key"
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

export default DictComponent;