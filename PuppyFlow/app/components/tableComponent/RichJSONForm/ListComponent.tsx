'use client'
import React from 'react';
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

    return (
        <div className="border-2 border-[#555] rounded-lg bg-[#1a1a1a] p-4 shadow-sm group/list relative">
            <div className="space-y-3">
                {data.map((item, index) => (
                    <div key={index} className="group relative">
                        <div className="flex items-start gap-3">
                            {/* Index Badge - 与dict保持相同的缩进 */}
                            <div className="flex-shrink-0 mt-1" style={{ width: '80px' }}>
                                <div className="h-[24px] flex items-center justify-center px-2 rounded-[4px] bg-[#252525] border border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors max-w-[80px] w-fit">
                                    <span className="text-[10px] font-semibold text-[#179FFF]">
                                        {index}
                                    </span>
                                </div>
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
                            
                            {/* Delete Button - 保持一致的样式 */}
                            {!readonly && (
                                <button
                                    onClick={() => deleteItem(index)}
                                    className="absolute -right-2 -top-2 w-5 h-5 rounded-full opacity-0 group-hover:opacity-100 
                                             bg-[#2a2a2a] hover:bg-[#dc2626] text-[#888] hover:text-white 
                                             transition-all duration-200 flex items-center justify-center z-10 border border-[#555] hover:border-[#dc2626]"
                                    title="Delete item"
                                >
                                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M18 6L6 18M6 6l12 12" />
                                    </svg>
                                </button>
                            )}
                        </div>
                    </div>
                ))}
                
                {/* Add New Item - 直接创建空元素 */}
                {!readonly && (
                    <>
                        {/* 触发区域 - 底部隐形区域 */}
                        <div className="absolute bottom-0 left-0 right-0 h-4 z-20" />
                        
                        <div className="absolute -bottom-2 left-4 invisible group-hover/list:visible transition-all duration-200 z-30">
                            <button
                                onClick={addEmptyItem}
                                className="group w-6 h-6 flex items-center justify-center rounded-[4px] 
                                         bg-[#252525] hover:bg-[#2a2a2a] border border-[#6D7177]/30 hover:border-[#6D7177]/50 
                                         transition-all duration-200 ease-out shadow-lg"
                                title="Add new item"
                            >
                                <svg 
                                    className="w-3 h-3 text-[#CDCDCD] transition-transform duration-200 group-hover:scale-110" 
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
                    </>
                )}
            </div>
        </div>
    );
};

export default ListComponent; 