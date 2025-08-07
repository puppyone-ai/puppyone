'use client'
import React, { createContext, useContext, useState } from 'react';
import TextComponent from './TextComponent';
import DictComponent from './DictComponent';
import ListComponent from './ListComponent';
import EmptyComponent from './EmptyComponent';

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
        // 完全匹配
        if (hoveredPath === path) return true;
        // 父子关系匹配
        return isChildPath(path, hoveredPath) || isParentPath(path, hoveredPath);
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
}

const ComponentRenderer = ({ 
    data, 
    path, 
    readonly = false, 
    onUpdate, 
    preventParentDrag, 
    allowParentDrag 
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

    // 在ComponentRenderer中，为每个子组件传递onDelete回调
    const createDeleteHandler = (currentPath: string) => {
        return () => {
            // 根据路径删除对应的元素
            const pathParts = currentPath.split(/[\.\[\]]+/).filter(Boolean);
            
            // 这里需要调用父组件的更新函数来删除元素
            // 具体实现取决于数据结构的管理方式
            console.log(`Delete requested for path: ${currentPath}`);
            
            // 示例：如果是数组元素，从数组中删除
            // 如果是对象属性，从对象中删除该键
            // 这需要根据实际的数据管理逻辑来实现
        };
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
                    onDelete={createDeleteHandler(path)}
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
                    onDelete={createDeleteHandler(path)}
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
                    onDelete={createDeleteHandler(path)}
                    preventParentDrag={preventParentDrag}
                    allowParentDrag={allowParentDrag}
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