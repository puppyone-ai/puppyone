'use client'
import React, { useState, useRef, useEffect } from 'react';

type ComponentType = 'text' | 'dict' | 'list';

type TypeSelectorProps = {
    onTypeSelect: (type: ComponentType) => void;
    onCancel: () => void;
    title?: string;
    compact?: boolean;
    defaultValue?: ComponentType;
    showAsCreated?: boolean;
    triggerElement?: HTMLElement;
}

const TypeSelector = ({ 
    onTypeSelect, 
    onCancel, 
    title = "Choose Component Type", 
    compact = false,
    defaultValue = 'text',
    showAsCreated = false,
    triggerElement
}: TypeSelectorProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const [selectedType, setSelectedType] = useState<ComponentType>(defaultValue);
    const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
    const buttonRef = useRef<HTMLButtonElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const types: { type: ComponentType; label: string; icon: string; description: string }[] = [
        { type: 'text', label: 'Text', icon: '📝', description: 'Simple text content' },
        { type: 'dict', label: 'Dictionary', icon: '📋', description: 'Key-value pairs' },
        { type: 'list', label: 'List', icon: '📃', description: 'Ordered list of items' }
    ];

    // Calculate dropdown position based on trigger element or button
    const updateDropdownPosition = () => {
        const element = triggerElement || buttonRef.current;
        if (element) {
            const rect = element.getBoundingClientRect();
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
            
            // 检查是否有足够空间在下方显示
            const spaceBelow = window.innerHeight - rect.bottom;
            const dropdownHeight = 300; // 估算的下拉菜单高度
            
            let top = rect.bottom + scrollTop + 4;
            
            // 如果下方空间不足，显示在上方
            if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
                top = rect.top + scrollTop - dropdownHeight - 4;
            }
            
            setDropdownPosition({
                top: top,
                left: rect.left + scrollLeft,
                width: Math.max(rect.width, 200) // 最小宽度 200px
            });
        }
    };

    // 初始定位
    useEffect(() => {
        if (showAsCreated || triggerElement) {
            updateDropdownPosition();
        }
    }, [showAsCreated, triggerElement]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node) &&
                buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        const handleScroll = () => {
            if (isOpen) {
                updateDropdownPosition();
            }
        };

        const handleResize = () => {
            if (isOpen) {
                updateDropdownPosition();
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            window.addEventListener('scroll', handleScroll, true);
            window.addEventListener('resize', handleResize);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('scroll', handleScroll, true);
            window.removeEventListener('resize', handleResize);
        };
    }, [isOpen]);

    const handleToggleDropdown = () => {
        if (!isOpen) {
            updateDropdownPosition();
        }
        setIsOpen(!isOpen);
    };

    const handleTypeSelect = (type: ComponentType) => {
        setSelectedType(type);
        setIsOpen(false);
        onTypeSelect(type);
    };

    const selectedTypeInfo = types.find(t => t.type === selectedType);

    // 如果是刚创建的元素，显示为已创建的样式
    if (showAsCreated) {
        return (
            <>
                <button
                    ref={buttonRef}
                    onClick={handleToggleDropdown}
                    className={`w-full border border-[#4B5563] bg-[#2A2D35] hover:bg-[#3A3D45] transition-colors text-left flex items-center justify-between ${
                        compact ? 'p-2 rounded-lg' : 'p-3 rounded-lg'
                    } ${isOpen ? 'ring-2 ring-blue-500 ring-opacity-50' : ''}`}
                >
                    <div className="flex items-center space-x-3">
                        <span className={compact ? 'text-sm' : 'text-lg'}>{selectedTypeInfo?.icon}</span>
                        <div>
                            <div className={`text-white font-medium ${compact ? 'text-xs' : 'text-sm'}`}>
                                {selectedTypeInfo?.label}
                            </div>
                            {!compact && (
                                <div className="text-[#9CA3AF] text-xs">{selectedTypeInfo?.description}</div>
                            )}
                        </div>
                    </div>
                    <svg 
                        className={`text-[#9CA3AF] transition-transform ${isOpen ? 'rotate-180' : ''} ${
                            compact ? 'w-3 h-3' : 'w-4 h-4'
                        }`}
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </button>

                {/* Fixed positioned dropdown portal */}
                {isOpen && (
                    <div
                        ref={dropdownRef}
                        className={`fixed bg-[#2A2D35] border border-[#4B5563] shadow-xl z-[9999] ${
                            compact ? 'rounded-lg' : 'rounded-xl'
                        }`}
                        style={{
                            top: `${dropdownPosition.top}px`,
                            left: `${dropdownPosition.left}px`,
                            width: `${dropdownPosition.width}px`,
                            minWidth: '200px'
                        }}
                    >
                        {types.map((typeInfo, index) => (
                            <button
                                key={typeInfo.type}
                                onClick={() => handleTypeSelect(typeInfo.type)}
                                className={`w-full text-left hover:bg-[#3A3D45] transition-colors flex items-center space-x-3 ${
                                    compact ? 'p-2' : 'p-3'
                                } ${
                                    index === 0 ? (compact ? 'rounded-t-lg' : 'rounded-t-xl') : ''
                                } ${
                                    selectedType === typeInfo.type ? 'bg-[#3A3D45] border-l-2 border-blue-500' : ''
                                }`}
                            >
                                <span className={compact ? 'text-sm' : 'text-lg'}>{typeInfo.icon}</span>
                                <div>
                                    <div className={`text-white font-medium ${compact ? 'text-xs' : 'text-sm'}`}>
                                        {typeInfo.label}
                                    </div>
                                    <div className={`text-[#9CA3AF] ${compact ? 'text-xs' : 'text-xs'}`}>
                                        {typeInfo.description}
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </>
        );
    }

    // 原始的类型选择器（用于初始选择）- 使用相对于触发元素的定位
    const getInitialPosition = () => {
        if (triggerElement) {
            return {
                position: 'fixed' as const,
                top: `${dropdownPosition.top}px`,
                left: `${dropdownPosition.left}px`,
                transform: 'none'
            };
        }
        // 默认居中
        return {
            position: 'fixed' as const,
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)'
        };
    };

    return (
        <div
            ref={dropdownRef}
            className={`bg-[#2A2D35] border border-[#4B5563] shadow-xl z-[9999] ${
                compact ? 'rounded-lg' : 'rounded-xl'
            } min-w-[240px]`}
            style={getInitialPosition()}
        >
            {!compact && title && (
                <div className="px-4 py-3 border-b border-[#4B5563]">
                    <h3 className="text-white text-sm font-semibold">{title}</h3>
                </div>
            )}
            
            {types.map((typeInfo, index) => (
                <button
                    key={typeInfo.type}
                    onClick={() => handleTypeSelect(typeInfo.type)}
                    className={`w-full text-left hover:bg-[#3A3D45] transition-colors flex items-center space-x-3 ${
                        compact ? 'p-3' : 'p-4'
                    } ${
                        index === 0 && (compact || !title) ? (compact ? 'rounded-t-lg' : 'rounded-t-xl') : ''
                    } ${
                        typeInfo.type === 'text' ? 'bg-[#3A3D45] border-l-2 border-blue-500' : ''
                    }`}
                >
                    <span className={compact ? 'text-lg' : 'text-2xl'}>{typeInfo.icon}</span>
                    <div className="flex-1">
                        <div className={`text-white font-medium ${compact ? 'text-sm' : 'text-base'}`}>
                            {typeInfo.label}
                            {typeInfo.type === 'text' && (
                                <span className="ml-2 text-xs text-blue-400">(Default)</span>
                            )}
                        </div>
                        <div className={`text-[#9CA3AF] ${compact ? 'text-xs' : 'text-sm'}`}>
                            {typeInfo.description}
                        </div>
                    </div>
                </button>
            ))}
            
            <div className="border-t border-[#4B5563]">
                <button
                    onClick={onCancel}
                    className={`w-full text-[#9CA3AF] hover:text-white hover:bg-[#3A3D45] transition-colors ${
                        compact ? 'p-2 text-xs rounded-b-lg' : 'p-3 text-sm rounded-b-xl'
                    }`}
                >
                    Cancel
                </button>
            </div>
        </div>
    );
};

export default TypeSelector; 