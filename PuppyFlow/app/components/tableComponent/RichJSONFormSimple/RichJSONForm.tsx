'use client'
import React, { useState, useRef, useEffect } from 'react';
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext';
import TypeSelector from './TypeSelector';
import TextComponent from './TextComponent';
import DictComponent from './DictComponent';
import ListComponent from './ListComponent';
import { createEmptyElement } from './ComponentRenderer';
import { OverflowProvider } from './OverflowContext';

type JSONViewerProps = {
    preventParentDrag: () => void,
    allowParentDrag: () => void,
    placeholder?: string,
    widthStyle?: number,
    heightStyle?: number,
    value?: string,
    readonly?: boolean,
    onChange?: (value: string) => void
}

type ComponentType = 'text' | 'dict' | 'list';

type JSONData = {
    [key: string]: any;
} | any[] | string;

// 辅助函数：清理空元素标识符（用于序列化）
const cleanEmptyElements = (data: any): any => {
    if (data && typeof data === 'object' && data.__isEmpty) {
        return null; // 或者返回适当的默认值
    }
    if (Array.isArray(data)) {
        return data.map(cleanEmptyElements);
    }
    if (typeof data === 'object' && data !== null) {
        const cleaned: any = {};
        for (const [key, value] of Object.entries(data)) {
            cleaned[key] = cleanEmptyElements(value);
        }
        return cleaned;
    }
    return data;
};

const JSONViewer = ({
    preventParentDrag, 
    allowParentDrag, 
    placeholder = "Enter JSON data...",
    widthStyle = 0,
    heightStyle = 0,
    value = "",
    readonly = false,
    onChange
}: JSONViewerProps) => {
    const [parsedData, setParsedData] = useState<JSONData | null>(null);
    const [isValidJSON, setIsValidJSON] = useState(false);
    const [showTypeSelector, setShowTypeSelector] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const { isOnGeneratingNewNode } = useNodesPerFlowContext();

    // 解析JSON数据
    useEffect(() => {
        if (!value || value.trim() === '') {
            setParsedData(null);
            setIsValidJSON(false);
            return;
        }

        try {
            const parsed = JSON.parse(value);
            setParsedData(parsed);
            setIsValidJSON(true);
        } catch (error) {
            setParsedData(null);
            setIsValidJSON(false);
        }
    }, [value]);

    // 判断组件类型
    const getComponentType = (data: JSONData | null): ComponentType => {
        if (typeof data === 'string') return 'text';
        if (Array.isArray(data)) return 'list';
        if (typeof data === 'object' && data !== null) return 'dict';
        return 'text';
    };

    // 创建新的组件
    const createNewComponent = (type: ComponentType) => {
        let newData: any;
        switch (type) {
            case 'text':
                newData = "";
                break;
            case 'dict':
                newData = {};
                break;
            case 'list':
                newData = [];
                break;
        }
        
        if (onChange) {
            onChange(JSON.stringify(newData, null, 2));
        }
        setShowTypeSelector(false);
    };

    // 更新数据
    const updateData = (newData: any) => {
        if (onChange) {
            // 清理空元素标识符后再序列化
            const cleanedData = cleanEmptyElements(newData);
            onChange(JSON.stringify(cleanedData, null, 2));
        }
    };

    // 处理文本编辑
    const handleTextEdit = (path: string, newValue: string) => {
        updateData(newValue);
    };

    // 渲染主要内容
    const renderMainContent = () => {
        if (parsedData === null) {
            return null;
        }

        const componentType = getComponentType(parsedData);
        
        switch (componentType) {
            case 'text':
                return (
                    <TextComponent
                        data={parsedData as string}
                        path="root"
                        readonly={readonly}
                        isRoot={true}
                        onEdit={handleTextEdit}
                        preventParentDrag={preventParentDrag}
                        allowParentDrag={allowParentDrag}
                    />
                );
            case 'dict':
                return (
                    <DictComponent
                        data={parsedData as Record<string, any>}
                        readonly={readonly}
                        isNested={false}
                        onUpdate={updateData}
                        preventParentDrag={preventParentDrag}
                        allowParentDrag={allowParentDrag}
                    />
                );
            case 'list':
                return (
                    <ListComponent
                        data={parsedData as any[]}
                        readonly={readonly}
                        isNested={false}
                        onUpdate={updateData}
                        preventParentDrag={preventParentDrag}
                        allowParentDrag={allowParentDrag}
                    />
                );
            default:
                return null;
        }
    };

    // 计算实际的宽高样式
    const actualWidth = widthStyle === 0 ? "100%" : widthStyle;
    const actualHeight = heightStyle === 0 ? "100%" : heightStyle;

    // 如果没有数据，显示类型选择器
    if (!value || value.trim() === '') {
        return (
            <div 
                className={`relative rounded-xl bg-transparent p-8 ${isOnGeneratingNewNode ? 'pointer-events-none opacity-70' : ''}`}
                style={{ width: actualWidth, height: actualHeight }}
            >
                {showTypeSelector ? (
                    <TypeSelector
                        onTypeSelect={createNewComponent}
                        onCancel={() => setShowTypeSelector(false)}
                    />
                ) : (
                    <div className="text-center">
                        <div className="text-[#6B7280] text-sm font-medium mb-4">
                            {placeholder}
                        </div>
                        {!readonly && (
                            <button
                                onClick={() => setShowTypeSelector(true)}
                                className="px-6 py-3 bg-[#4F8EF7] text-white rounded-lg hover:bg-[#3B82F6] transition-colors font-medium"
                            >
                                Create New Component
                            </button>
                        )}
                    </div>
                )}
            </div>
        );
    }

    if (!isValidJSON) {
        return (
            <div 
                className={`relative flex flex-col border border-[#EF4444] rounded-xl bg-transparent p-4 ${isOnGeneratingNewNode ? 'pointer-events-none opacity-70' : ''}`}
                style={{ width: actualWidth, height: actualHeight }}
            >
                <div className="flex items-center mb-2">
                    <svg className="w-4 h-4 text-[#EF4444] mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="text-[#EF4444] text-sm font-semibold">Invalid JSON</span>
                </div>
                <div className="text-[#6B7280] text-sm font-mono overflow-auto">
                    {value}
                </div>
            </div>
        );
    }

    return (
        <OverflowProvider>
            <div 
                ref={containerRef}
                className={`relative bg-transparent overflow-auto scrollbar-hide ${isOnGeneratingNewNode ? 'pointer-events-none opacity-70' : ''}`}
                style={{ width: actualWidth, height: actualHeight }}
                data-rich-json-form="true"
            >
                {renderMainContent()}
            </div>
        </OverflowProvider>
    );
};

export default JSONViewer;