'use client'
import React, { useState } from 'react';
import ComponentRenderer, { createEmptyElement } from './ComponentRenderer';

type ListComponentProps = {
    data: any[];
    readonly?: boolean;
    isNested?: boolean;
    onUpdate: (newData: any[]) => void;
    preventParentDrag: () => void;
    allowParentDrag: () => void;
}

const ListComponent = ({ 
    data, 
    readonly = false, 
    isNested = false, 
    onUpdate, 
    preventParentDrag, 
    allowParentDrag 
}: ListComponentProps) => {
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

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
        // 防止父级拖拽
        preventParentDrag();
    };

    const handleDragEnd = () => {
        setDraggedIndex(null);
        setDragOverIndex(null);
        setSelectedIndex(null);
        // 恢复父级拖拽
        allowParentDrag();
    };

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverIndex(index);
    };

    const handleDragLeave = () => {
        setDragOverIndex(null);
    };

    const handleDrop = (e: React.DragEvent, dropIndex: number) => {
        e.preventDefault();
        
        if (draggedIndex === null || draggedIndex === dropIndex) {
            return;
        }

        const newData = [...data];
        const draggedItem = newData[draggedIndex];
        
        // 移除被拖拽的项
        newData.splice(draggedIndex, 1);
        
        // 插入到新位置
        const insertIndex = draggedIndex < dropIndex ? dropIndex - 1 : dropIndex;
        newData.splice(insertIndex, 0, draggedItem);
        
        onUpdate(newData);
        setDraggedIndex(null);
        setDragOverIndex(null);
    };

    return (
        <div className="bg-[#252525] shadow-sm group/list relative">
            <div className="space-y-0">
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
                        {data.map((item, index) => (
                            <React.Fragment key={index}>
                                {/* Drop Indicator Line - 在当前元素上方显示插入指示线 */}
                                {dragOverIndex === index && draggedIndex !== null && draggedIndex !== index && (
                                    <div className="relative">
                                        <div className="absolute inset-x-0 -top-[2px] h-[2px] bg-blue-400 z-40 rounded-full shadow-lg">
                                            <div className="absolute left-2 -top-1 w-2 h-2 bg-blue-400 rounded-full"></div>
                                        </div>
                                    </div>
                                )}
                                
                                <div 
                                    className={`group relative transition-all duration-200 ${
                                        selectedIndex === index || draggedIndex === index
                                            ? 'bg-blue-500/20' 
                                            : 'hover:bg-[#6D7177]/20'
                                    }`}
                                    onDragOver={(e) => handleDragOver(e, index)}
                                    onDragLeave={handleDragLeave}
                                    onDrop={(e) => handleDrop(e, index)}
                                >
                                    <div className="flex items-stretch">
                                        {/* Index Badge - 与 DictComponent 中的 key 样式保持一致 */}
                                        <div className="flex-shrink-0 flex justify-center">
                                            <div className="w-[64px] pt-[4px] bg-transparent rounded-md overflow-hidden transition-colors duration-200 flex justify-center">
                                                <span className="text-[10px] text-[#ff9b4d] break-words leading-[28px] font-plus-jakarta-sans italic">
                                                    {index}
                                                </span>
                                            </div>
                                        </div>
                                        
                                        {/* Vertical Divider Line with Drag Handle */}
                                        <div className="flex-shrink-0 flex items-center relative">
                                            <div className="w-[1px] bg-[#6D7177]/70 h-full"></div>
                                            
                                            {/* Drag Handle - 在竖线上 */}
                                            {!readonly && (
                                                <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 z-30">
                                                    <div 
                                                        draggable
                                                        onMouseDown={() => handleMouseDown(index)}
                                                        onMouseUp={handleMouseUp}
                                                        onDragStart={(e) => handleDragStart(e, index)}
                                                        onDragEnd={handleDragEnd}
                                                        className={`w-4 h-6 flex items-center justify-center rounded-[3px] 
                                                                  border transition-all duration-200 ease-out cursor-pointer
                                                                  ${selectedIndex === index || draggedIndex === index
                                                                      ? 'bg-blue-500 border-blue-400 opacity-100' 
                                                                      : 'bg-[#252525] hover:bg-[#2a2a2a] border-[#6D7177]/30 hover:border-[#6D7177]/50 opacity-0 group-hover:opacity-100'
                                                                  }`}
                                                    >
                                                        <div className="flex flex-col items-center gap-[2px]">
                                                            <div className={`w-[2px] h-[2px] rounded-full ${
                                                                selectedIndex === index || draggedIndex === index ? 'bg-white' : 'bg-[#CDCDCD]'
                                                            }`}></div>
                                                            <div className={`w-[2px] h-[2px] rounded-full ${
                                                                selectedIndex === index || draggedIndex === index ? 'bg-white' : 'bg-[#CDCDCD]'
                                                            }`}></div>
                                                            <div className={`w-[2px] h-[2px] rounded-full ${
                                                                selectedIndex === index || draggedIndex === index ? 'bg-white' : 'bg-[#CDCDCD]'
                                                            }`}></div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        
                                        {/* Content */}
                                        <div className="flex-1 min-w-0">
                                            <ComponentRenderer
                                                data={item}
                                                path={`[${index}]`}
                                                readonly={readonly}
                                                onUpdate={(newValue) => updateItem(index, newValue)}
                                                preventParentDrag={preventParentDrag}
                                                allowParentDrag={allowParentDrag}
                                            />
                                        </div>
                                    </div>
                                </div>
                                
                                {/* 最后一个元素后的插入指示线 */}
                                {index === data.length - 1 && dragOverIndex === index && draggedIndex !== null && draggedIndex !== index && (
                                    <div className="relative">
                                        <div className="absolute inset-x-0 top-[2px] h-[2px] bg-blue-400 z-40 rounded-full shadow-lg">
                                            <div className="absolute left-2 -top-1 w-2 h-2 bg-blue-400 rounded-full"></div>
                                        </div>
                                    </div>
                                )}
                                
                                {/* Horizontal Divider Line - 在元素之间添加水平分隔线 */}
                                {index < data.length - 1 && (
                                    <div className="w-full h-[1px] bg-[#6D7177]/70 my-[4px]"></div>
                                )}
                            </React.Fragment>
                        ))}
                        
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