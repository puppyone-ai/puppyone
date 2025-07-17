'use client'
import React from 'react';
import ComponentRenderer, { createEmptyElement } from './ComponentRenderer';

type DictComponentProps = {
    data: Record<string, any>;
    readonly?: boolean;
    isNested?: boolean;
    onUpdate: (newData: Record<string, any>) => void;
    preventParentDrag: () => void;
    allowParentDrag: () => void;
}

const DictComponent = ({ 
    data, 
    readonly = false, 
    isNested = false, 
    onUpdate, 
    preventParentDrag, 
    allowParentDrag 
}: DictComponentProps) => {

    const keys = Object.keys(data);

    const deleteKey = (keyToDelete: string) => {
        const newData = { ...data };
        delete newData[keyToDelete];
        onUpdate(newData);
    };

    // 生成随机key的函数
    const generateRandomKey = () => {
        const existingKeys = Object.keys(data);
        let newKey = `key_${Math.random().toString(36).substr(2, 6)}`;
        
        // 确保key不重复
        while (existingKeys.includes(newKey)) {
            newKey = `key_${Math.random().toString(36).substr(2, 6)}`;
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

    return (
        <div className="border-[1px] border-[#555] rounded-lg bg-[#1a1a1a] m-[8px] p-[8px] shadow-sm group/dict relative">
            <div className="space-y-[4px]">
                {keys.map((key) => (
                    <div key={key} className="group relative hover:bg-[#252525] rounded-lg transition-colors duration-200">
                        <div className="flex items-start gap-[8px]">
                            {/* Key Badge - 与list保持相同的样式 */}
                            <div className="flex-shrink-0" style={{ width: '64px' }}>
                                <div className="h-[24px] flex items-center justify-center px-2 my-[16px] mx-[8px] rounded-[4px] bg-[#252525] border border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors max-w-[64px] w-fit">
                                    <span className="text-[10px] font-semibold text-[#ff90ac] break-words leading-tight">
                                        {key}
                                    </span>
                                </div>
                            </div>
                            
                            {/* Content */}
                            <div className="flex-1 min-w-0">
                                <ComponentRenderer
                                    data={data[key]}
                                    path={key}
                                    readonly={readonly}
                                    onUpdate={(newValue) => updateValue(key, newValue)}
                                    preventParentDrag={preventParentDrag}
                                    allowParentDrag={allowParentDrag}
                                />
                            </div>
                            
                            {/* Delete Button - 保持一致的样式 */}
                            {!readonly && (
                                <button
                                    onClick={() => deleteKey(key)}
                                    className="absolute -right-2 -top-2 w-5 h-5 rounded-full opacity-0 group-hover:opacity-100 
                                             bg-[#2a2a2a] hover:bg-[#dc2626] text-[#888] hover:text-white 
                                             transition-all duration-200 flex items-center justify-center z-10 border border-[#555] hover:border-[#dc2626]"
                                    title="Delete key"
                                >
                                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M18 6L6 18M6 6l12 12" />
                                    </svg>
                                </button>
                            )}
                        </div>
                    </div>
                ))}
                
                {/* Add New Key - 直接创建空元素 */}
                {!readonly && (
                    <>
                        {/* 触发区域 - 底部隐形区域 */}
                        <div className="absolute bottom-0 left-0 right-0 h-4 z-20" />
                        
                        <div className="absolute -bottom-2 left-4 invisible group-hover/dict:visible transition-all duration-200 z-30">
                            <button
                                onClick={addEmptyKey}
                                className="group w-6 h-6 flex items-center justify-center rounded-[4px] 
                                         bg-[#252525] hover:bg-[#2a2a2a] border border-[#6D7177]/30 hover:border-[#6D7177]/50 
                                         transition-all duration-200 ease-out shadow-lg"
                                title="Add new key"
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

export default DictComponent;