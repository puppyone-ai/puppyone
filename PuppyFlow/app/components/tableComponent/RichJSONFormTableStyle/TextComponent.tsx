'use client'
import React from 'react';
import { useHover, DragHandle } from './ComponentRenderer';
import TextEditor from '../TextEditor';

type TextComponentProps = {
    data: string;
    path: string;
    readonly?: boolean;
    onEdit: (path: string, newValue: string) => void;
    onDelete?: () => void;
    parentKey?: string | number;
    preventParentDrag: () => void;
    allowParentDrag: () => void;
}

const TextComponent = ({ 
    data, 
    path,
    readonly = false, 
    onEdit, 
    onDelete,
    parentKey,
    preventParentDrag, 
    allowParentDrag 
}: TextComponentProps) => {
    const { setHoveredPath, isPathHovered } = useHover();
    const isTextHovered = isPathHovered(path);

    const handleEditChange = (newValue: string) => {
        if (!readonly) {
            onEdit(path, newValue);
        }
    };

    const handleTextHover = (isEntering: boolean) => {
        if (isEntering) {
            setHoveredPath(path);
        } else {
            setHoveredPath(null);
        }
    };

    return (
        <div className="bg-[#252525] shadow-sm relative group">
            {/* Unified Drag Handle */}
            <DragHandle
                data={data}
                path={path}
                parentKey={parentKey}
                componentType="text"
                readonly={readonly}
                onDelete={onDelete}
                preventParentDrag={preventParentDrag}
                allowParentDrag={allowParentDrag}
                color="#4CAF50"
            />
            
            {/* Visual border indicator */}
            <div className="absolute left-0 top-1 bottom-1 w-[2px] bg-[#4CAF50]/40 rounded-full"></div>
            
            <div 
                className={`w-full px-[16px] py-[8px] bg-transparent overflow-hidden transition-colors duration-200 ${
                    isTextHovered ? 'bg-[#CDCDCD]/10' : 'hover:bg-[#6D7177]/10'
                } ${readonly ? 'opacity-60' : ''}`}
                onMouseEnter={() => handleTextHover(true)}
                onMouseLeave={() => handleTextHover(false)}
                onDragOver={(e) => {
                    // Text components don't accept drops - show not-allowed cursor
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'none';
                }}
                onDrop={(e) => {
                    // Prevent any drops on text elements
                    e.preventDefault();
                    e.stopPropagation();
                }}
            >
                <TextEditor
                    preventParentDrag={preventParentDrag}
                    allowParentDrag={allowParentDrag}
                    value={data}
                    onChange={readonly ? () => {} : handleEditChange}
                    placeholder="Enter text content..."
                    widthStyle={0}
                    autoHeight={true}
                />
            </div>
        </div>
    );
};

export default TextComponent;