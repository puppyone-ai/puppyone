'use client'
import React, { createContext, useContext, useState } from 'react';
import TextComponent from './TextComponent';
import DictComponent from './DictComponent';
import ListComponent from './ListComponent';
import EmptyComponent from './EmptyComponent';

// Drag capability removed

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

// Selection Context
type SelectionContextType = {
    selectedPath: string | null;
    setSelectedPath: (path: string | null) => void;
    isPathSelected: (path: string) => boolean;
};

const SelectionContext = createContext<SelectionContextType | null>(null);

export const SelectionProvider = ({ children }: { children: React.ReactNode }) => {
    const [selectedPath, setSelectedPath] = useState<string | null>(null);

    const isPathSelected = (path: string): boolean => {
        // Treat empty string "" as a valid root path; only null means no selection
        return selectedPath === path;
    };

    return (
        <SelectionContext.Provider value={{ selectedPath, setSelectedPath, isPathSelected }}>
            {children}
        </SelectionContext.Provider>
    );
};

export const useSelection = () => {
    const context = useContext(SelectionContext);
    if (!context) {
        throw new Error('useSelection must be used within SelectionProvider');
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
            case 'text': {
                newValue = "";
                break;
            }
            case 'dict': {
                // 预制两个空位的字典
                newValue = { key1: null, key2: null };
                break;
            }
            case 'list': {
                // 预制两个空位的列表
                newValue = [null, null];
                break;
            }
            default: {
                newValue = null;
            }
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
                    path={path}
                    onReplace={onUpdate}
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
                    onReplace={onUpdate}
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
                    onReplace={onUpdate}
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
                    onReplace={onUpdate}
                />
            );
        default:
            return null;
    }
};

// 创建空元素的函数
export const createEmptyElement = () => ({
    __isEmpty: true
});

export default ComponentRenderer;