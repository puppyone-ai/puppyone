'use client'
import React, { createContext, useContext, useState } from 'react';
import TextComponent from './TextComponent';
import DictComponent from './DictComponent';
import ListComponent from './ListComponent';
import EmptyComponent from './EmptyComponent';

// Drag Context for cross-component dragging
type DragContextType = {
    draggedItem: any;
    draggedPath: string;
    draggedKey: string | number | null;
    draggedParentType: 'dict' | 'list' | null;
    sourceOnDelete: (() => void) | null;
    setDraggedItem: (item: any, path: string, key: string | number | null, parentType: 'dict' | 'list' | null, onDelete?: () => void) => void;
    clearDraggedItem: () => void;
};

const DragContext = createContext<DragContextType | null>(null);

export const DragProvider = ({ children }: { children: React.ReactNode }) => {
    const [draggedItem, setDraggedItemState] = useState<any>(null);
    const [draggedPath, setDraggedPath] = useState<string>('');
    const [draggedKey, setDraggedKey] = useState<string | number | null>(null);
    const [draggedParentType, setDraggedParentType] = useState<'dict' | 'list' | null>(null);
    const [sourceOnDelete, setSourceOnDelete] = useState<(() => void) | null>(null);

    const setDraggedItem = (item: any, path: string, key: string | number | null, parentType: 'dict' | 'list' | null, onDelete?: () => void) => {
        setDraggedItemState(item);
        setDraggedPath(path);
        setDraggedKey(key);
        setDraggedParentType(parentType);
        setSourceOnDelete(onDelete ? () => onDelete : null);
    };

    const clearDraggedItem = () => {
        setDraggedItemState(null);
        setDraggedPath('');
        setDraggedKey(null);
        setDraggedParentType(null);
        setSourceOnDelete(null);
    };

    return (
        <DragContext.Provider value={{
            draggedItem,
            draggedPath,
            draggedKey,
            draggedParentType,
            sourceOnDelete,
            setDraggedItem,
            clearDraggedItem
        }}>
            {children}
        </DragContext.Provider>
    );
};

export const useDrag = () => {
    const context = useContext(DragContext);
    if (!context) {
        throw new Error('useDrag must be used within DragProvider');
    }
    return context;
};

// Hover Context
type HoverContextType = {
    hoveredPath: string | null;
    setHoveredPath: (path: string | null) => void;
    isPathHovered: (path: string) => boolean;
    isChildPath: (childPath: string, parentPath: string) => boolean;
    isParentPath: (parentPath: string, childPath: string) => boolean;
};

const HoverContext = createContext<HoverContextType | null>(null);

export const HoverProvider = ({ children }: { children: React.ReactNode }) => {
    const [hoveredPath, setHoveredPath] = useState<string | null>(null);

    const isChildPath = (childPath: string, parentPath: string): boolean => {
        if (!parentPath || !childPath) return false;
        if (parentPath === '') return true; // root is parent of everything
        return childPath.startsWith(parentPath + '.') || childPath.startsWith(parentPath + '[');
    };

    const isParentPath = (parentPath: string, childPath: string): boolean => {
        if (!parentPath || !childPath) return false;
        if (parentPath === '') return false;
        return childPath.startsWith(parentPath) && childPath !== parentPath;
    };

    const isPathHovered = (path: string): boolean => {
        if (!hoveredPath) return false;
        // 只有完全匹配才显示hover状态
        return hoveredPath === path;
    };

    return (
        <HoverContext.Provider value={{
            hoveredPath,
            setHoveredPath,
            isPathHovered,
            isChildPath,
            isParentPath
        }}>
            {children}
        </HoverContext.Provider>
    );
};

export const useHover = () => {
    const context = useContext(HoverContext);
    if (!context) {
        throw new Error('useHover must be used within HoverProvider');
    }
    return context;
};

type ComponentType = 'text' | 'dict' | 'list';

// 定义一个特殊的空元素标识符
const EMPTY_ELEMENT_SYMBOL = Symbol('empty_element');

type ComponentRendererProps = {
    data: any;
    path: string;
    readonly?: boolean;
    onUpdate: (newValue: any) => void;
    preventParentDrag: () => void;
    allowParentDrag: () => void;
    parentKey?: string | number; // Key in parent structure
    onDelete?: () => void; // Delete callback from parent
}


const ComponentRenderer = ({ 
    data, 
    path, 
    readonly = false, 
    onUpdate, 
    preventParentDrag, 
    allowParentDrag,
    parentKey,
    onDelete 
}: ComponentRendererProps) => {
    const getComponentType = (value: any) => {
        // 检查是否是空元素标记
        if (value && typeof value === 'object' && value.__isEmpty === true) {
            return 'empty';
        }
        // 检查是否是null、undefined或其他需要显示为空元素的值
        if (value === null || value === undefined) {
            return 'empty';
        }
        if (typeof value === 'string') return 'text';
        if (Array.isArray(value)) return 'list';
        if (typeof value === 'object' && value !== null) return 'dict';
        // 对于其他类型，也显示为空元素让用户选择
        return 'empty';
    };

    const componentType = getComponentType(data);

    const handleEdit = (editPath: string, newValue: string) => {
        onUpdate(newValue);
    };

    const handleTypeSelect = (type: ComponentType) => {
        let newValue: any;
        switch (type) {
            case 'text':
                newValue = "";
                break;
            case 'dict':
                newValue = {};
                break;
            case 'list':
                newValue = [];
                break;
            default:
                newValue = null;
        }
        onUpdate(newValue);
    };

    // Delete handler - now uses the onDelete prop from parent
    const handleDelete = () => {
        if (onDelete) {
            onDelete();
        }
    };

    switch (componentType) {
        case 'empty':
            return (
                <EmptyComponent
                    onTypeSelect={handleTypeSelect}
                    preventParentDrag={preventParentDrag}
                    allowParentDrag={allowParentDrag}
                    readonly={readonly}
                />
            );
        case 'text':
            return (
                <TextComponent
                    data={data}
                    path={path}
                    readonly={readonly}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    parentKey={parentKey}
                    preventParentDrag={preventParentDrag}
                    allowParentDrag={allowParentDrag}
                />
            );
        case 'dict':
            return (
                <DictComponent
                    data={data}
                    path={path}
                    readonly={readonly}
                    isNested={true}
                    onUpdate={onUpdate}
                    onDelete={handleDelete}
                    parentKey={parentKey}
                    preventParentDrag={preventParentDrag}
                    allowParentDrag={allowParentDrag}
                />
            );
        case 'list':
            return (
                <ListComponent
                    data={data}
                    path={path}
                    readonly={readonly}
                    isNested={true}
                    onUpdate={onUpdate}
                    onDelete={handleDelete}
                    parentKey={parentKey}
                    preventParentDrag={preventParentDrag}
                    allowParentDrag={allowParentDrag}
                />
            );
        default:
            return null;
    }
};

// Unified Drag Handle Component
type DragHandleProps = {
    data: any;
    path: string;
    parentKey?: string | number;
    componentType: 'text' | 'dict' | 'list';
    readonly?: boolean;
    onDelete?: () => void;
    preventParentDrag: () => void;
    allowParentDrag: () => void;
    color: string; // Handle color based on component type
};

export const DragHandle = ({
    data,
    path,
    parentKey,
    componentType,
    readonly,
    onDelete,
    preventParentDrag,
    allowParentDrag,
    color
}: DragHandleProps) => {
    const { setDraggedItem, clearDraggedItem } = useDrag();
    const { setHoveredPath } = useHover();

    // Don't show handle if readonly or no delete callback
    if (readonly || !onDelete) {
        return null;
    }

    const handleDragStart = (e: React.DragEvent) => {
        e.stopPropagation();
        
        // Determine parent type from path
        const parentType = path.includes('[') ? 'list' : 'dict';
        
        // Set dragged item with delete callback
        setDraggedItem(data, path, parentKey || null, parentType, onDelete);
        e.dataTransfer.effectAllowed = 'move';
        
        // Visual feedback
        const dragPreview = createComponentDragPreview(data, componentType);
        document.body.appendChild(dragPreview);
        e.dataTransfer.setDragImage(dragPreview, 10, 10);
        
        setTimeout(() => {
            if (document.body.contains(dragPreview)) {
                document.body.removeChild(dragPreview);
            }
        }, 0);
        
        preventParentDrag();
        setHoveredPath(path);
    };

    const handleDragEnd = () => {
        clearDraggedItem();
        allowParentDrag();
        setHoveredPath(null);
    };

    const createComponentDragPreview = (value: any, type: string) => {
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
        
        const typeSpan = document.createElement('span');
        typeSpan.style.cssText = `
            color: ${type === 'text' ? '#4CAF50' : type === 'dict' ? '#9b7edb' : '#ff9b4d'};
            font-weight: bold;
            margin-right: 8px;
        `;
        typeSpan.textContent = type.toUpperCase();
        
        const valueSpan = document.createElement('span');
        valueSpan.style.cssText = `
            color: #CDCDCD;
            opacity: 0.8;
        `;
        
        let valuePreview = '';
        if (type === 'text') {
            valuePreview = value.length > 30 ? `"${value.substring(0, 30)}..."` : `"${value}"`;
        } else if (type === 'list') {
            valuePreview = `[${value.length} items]`;
        } else if (type === 'dict') {
            const keys = Object.keys(value);
            valuePreview = `{${keys.length} keys}`;
        }
        
        valueSpan.textContent = valuePreview;
        
        preview.appendChild(typeSpan);
        preview.appendChild(valueSpan);
        
        return preview;
    };

    return (
        <div 
            className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-50"
            style={{ backgroundColor: color }}
        >
            <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2">
                <button
                    draggable={true}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    className="w-4 h-6 bg-[#252525] border rounded-[3px] flex flex-col items-center justify-center gap-0.5 shadow-lg hover:bg-[#2a2a2a] transition-colors duration-200 cursor-move"
                    style={{ borderColor: `${color}50` }}
                    title={`Drag to move this ${componentType}`}
                >
                    <div className="w-0.5 h-0.5 rounded-full" style={{ backgroundColor: color }}></div>
                    <div className="w-0.5 h-0.5 rounded-full" style={{ backgroundColor: color }}></div>
                    <div className="w-0.5 h-0.5 rounded-full" style={{ backgroundColor: color }}></div>
                </button>
            </div>
        </div>
    );
};

// 创建空元素的函数
export const createEmptyElement = () => ({
    __isEmpty: true
});

export default ComponentRenderer;