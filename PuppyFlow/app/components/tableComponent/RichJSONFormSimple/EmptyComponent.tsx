'use client'
import React from 'react';
import { PuppyDropdown } from '@/app/components/misc/PuppyDropDown';
import { PuppyDropdownWithOverflow } from '@/app/components/misc/PuppyDropDownWithOverflow';

type ComponentType = 'text' | 'dict' | 'list';

type EmptyComponentProps = {
    onTypeSelect: (type: ComponentType) => void;
    preventParentDrag: () => void;
    allowParentDrag: () => void;
    readonly?: boolean;
}

// EmptyComponent 主组件
const EmptyComponent = ({ 
    onTypeSelect, 
    preventParentDrag, 
    allowParentDrag,
    readonly = false
}: EmptyComponentProps) => {
    const types = [
        { type: 'text', label: 'Text', icon: '📝', description: 'Simple text content' },
        { type: 'dict', label: 'Dictionary', icon: '📋', description: 'Key-value pairs' },
        { type: 'list', label: 'List', icon: '📃', description: 'Ordered list of items' }
    ];

    const handleTypeSelect = (typeInfo: any) => {
        onTypeSelect(typeInfo.type);
    };

    // 自定义渲染选项
    const renderOption = (option: any) => (
        <div className="flex items-center space-x-3 p-2">
            <div className="w-6 h-6 flex items-center justify-center bg-[#252525] rounded border border-[#6D7177]/30">
                <span className="text-sm">{option.icon}</span>
            </div>
            <div className="flex-1">
                <div className="text-white font-medium text-sm flex items-center">
                    {option.label}
                    {option.type === 'text' && (
                        <span className="ml-2 text-xs text-[#888] bg-[#333] px-1 py-0.5 rounded">Default</span>
                    )}
                </div>
                <div className="text-[#888] text-xs">
                    {option.description}
                </div>
            </div>
        </div>
    );

    return (
        <div className={`w-full bg-transparent rounded-md border-2 border-dashed border-[#555] 
                        hover:border-[#666] hover:bg-[#2a2a2a]/30 transition-colors min-h-[40px] 
                        ${readonly ? 'cursor-not-allowed opacity-50' : ''}`}>
            {readonly ? (
                <div className="px-3 py-2 flex items-center justify-center">
                    <div className="text-[#888] text-sm italic flex items-center space-x-2">
                        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M8 3v10M3 8h10" />
                        </svg>
                        <span>Click to choose type...</span>
                    </div>
                </div>
            ) : (
                <PuppyDropdownWithOverflow
                    options={types}
                    onSelect={handleTypeSelect}
                    selectedValue={null}
                    breakBoundary={true}
                    listWidth="300px"
                    buttonHeight="40px"
                    buttonBgColor="transparent"
                    menuBgColor="#1a1a1a"
                    containerClassnames="!px-3 !py-2 w-full h-full"
                    mapValueTodisplay={() => (
                        <div className="text-[#888] text-sm italic flex items-center space-x-2">
                            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <path d="M8 3v10M3 8h10" />
                            </svg>
                            <span>Click to choose type...</span>
                        </div>
                    )}
                    renderOption={renderOption}
                    showDropdownIcon={false}
                />
            )}
        </div>
    );
};

export default EmptyComponent; 