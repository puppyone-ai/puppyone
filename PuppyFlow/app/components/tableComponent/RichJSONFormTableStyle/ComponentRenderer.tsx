'use client'
import React from 'react';
import TextComponent from './TextComponent';
import DictComponent from './DictComponent';
import ListComponent from './ListComponent';
import EmptyComponent from './EmptyComponent';

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
        }
        onUpdate(newValue);
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
                    preventParentDrag={preventParentDrag}
                    allowParentDrag={allowParentDrag}
                />
            );
        case 'dict':
            return (
                <DictComponent
                    data={data}
                    readonly={readonly}
                    isNested={true}
                    onUpdate={onUpdate}
                    preventParentDrag={preventParentDrag}
                    allowParentDrag={allowParentDrag}
                />
            );
        case 'list':
            return (
                <ListComponent
                    data={data}
                    readonly={readonly}
                    isNested={true}
                    onUpdate={onUpdate}
                    preventParentDrag={preventParentDrag}
                    allowParentDrag={allowParentDrag}
                />
            );
        default:
            return null;
    }
};

export default ComponentRenderer;

// 导出创建空元素的辅助函数 - 现在创建null而不是对象
export const createEmptyElement = () => null; 