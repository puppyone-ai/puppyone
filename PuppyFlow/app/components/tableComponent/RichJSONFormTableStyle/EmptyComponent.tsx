'use client'
import React, { useState } from 'react';

type ComponentType = 'text' | 'dict' | 'list';

type EmptyComponentProps = {
    onTypeSelect: (type: ComponentType) => void;
    preventParentDrag: () => void;
    allowParentDrag: () => void;
    readonly?: boolean;
    selectedType?: ComponentType | null;
    showAsSelected?: boolean;
}

// EmptyComponent 主组件
const EmptyComponent = ({ 
    onTypeSelect, 
    preventParentDrag, 
    allowParentDrag,
    readonly = false,
    selectedType = null,
    showAsSelected = false
}: EmptyComponentProps) => {
    const [isOpen, setIsOpen] = useState(false);
    
    const types = [
        { 
            type: 'text' as ComponentType, 
            label: 'text',
            description: 'Simple text content',
            icon: (
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M2 4h12M2 8h8M2 12h10" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            )
        },
        { 
            type: 'list' as ComponentType, 
            label: 'list',
            description: 'Ordered list of items',
            icon: (
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M6 4h8M6 8h8M6 12h8M2 4h.01M2 8h.01M2 12h.01" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            )
        },
        { 
            type: 'dict' as ComponentType, 
            label: 'dict',
            description: 'Key-value pairs',
            icon: (
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M3 3v3l-1 2 1 2v3M13 3v3l1 2-1 2v3" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M7 5v1M8 7v1M7 9v1" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            )
        }
    ];

    const handleTypeSelect = (type: ComponentType) => {
        onTypeSelect(type);
        setIsOpen(false);
    };

    const selectedTypeInfo = selectedType ? types.find(t => t.type === selectedType) : null;

    // 如果显示为已选择状态（类似 TypeSelector 的 showAsCreated）
    if (showAsSelected && selectedTypeInfo) {
        return (
            <div className="w-full">
                <div className="w-full px-[16px] py-[8px] bg-transparent rounded-md overflow-hidden transition-colors duration-200">
                    <button
                        onClick={() => setIsOpen(!isOpen)}
                        className="flex items-center justify-between w-full h-[24px] bg-[#2A2D35] hover:bg-[#3A3D45] border border-[#4B5563] rounded-lg px-3 py-1 transition-colors"
                        onMouseDown={preventParentDrag}
                        onMouseUp={allowParentDrag}
                    >
                        <div className="flex items-center space-x-2">
                            {selectedTypeInfo.icon}
                            <span className="text-[12px] text-white font-plus-jakarta-sans">
                                {selectedTypeInfo.label}
                            </span>
                        </div>
                        <svg 
                            className={`w-3 h-3 text-[#9CA3AF] transition-transform ${isOpen ? 'rotate-180' : ''}`}
                            fill="none" 
                            stroke="currentColor" 
                            viewBox="0 0 24 24"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>
                    
                    {/* Dropdown menu */}
                    {isOpen && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-[#2A2D35] border border-[#4B5563] rounded-lg shadow-xl z-50">
                            {types.map((typeInfo) => (
                                <button
                                    key={typeInfo.type}
                                    onClick={() => handleTypeSelect(typeInfo.type)}
                                    className={`w-full text-left hover:bg-[#3A3D45] transition-colors flex items-center space-x-3 p-3 first:rounded-t-lg last:rounded-b-lg ${
                                        selectedType === typeInfo.type ? 'bg-[#3A3D45] border-l-2 border-blue-500' : ''
                                    }`}
                                >
                                    {typeInfo.icon}
                                    <div>
                                        <div className="text-white font-medium text-sm">
                                            {typeInfo.label}
                                        </div>
                                        <div className="text-[#9CA3AF] text-xs">
                                            {typeInfo.description}
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // 默认的类型选择状态
    return (
        <div className="w-full">
            <div className="w-full px-[16px] py-[8px] bg-transparent rounded-md overflow-hidden transition-colors duration-200">
                {readonly ? (
                    <div className="flex items-center h-[24px]">
                        <div className="text-[#6D7177] text-[12px] italic leading-normal font-plus-jakarta-sans">
                            type or text / list / dict
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center h-[24px] space-x-2">
                        <span className="text-[#6D7177] text-[12px] italic leading-normal font-plus-jakarta-sans">
                            create a type
                        </span>
                        {types.map((typeInfo) => (
                            <button
                                key={typeInfo.type}
                                onClick={() => handleTypeSelect(typeInfo.type)}
                                className="flex items-center justify-center w-6 h-5 bg-[#2a2a2a] hover:bg-[#3a3a3a] border border-[#6D7177]/30 hover:border-[#6D7177]/50 rounded-md text-[#CDCDCD] hover:text-white transition-all duration-200"
                                onMouseDown={preventParentDrag}
                                onMouseUp={allowParentDrag}
                                title={`Create ${typeInfo.label}`}
                            >
                                {typeInfo.icon}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default EmptyComponent; 