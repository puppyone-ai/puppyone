'use client'
import React, { useState, useRef } from 'react';
import { useTreeContext } from './TreeContext';

type TextNodeProps = {
    data: any;
    path: string;
    parentKey?: string | number;
    parentType?: 'dict' | 'list' | 'root';
    depth?: number;
    readonly?: boolean;
    onUpdate: (newData: any) => void;
    onDelete?: () => void;
};

const TextNode = ({
    data,
    path,
    parentKey,
    parentType = 'root',
    depth = 0,
    readonly = false,
    onUpdate,
    onDelete
}: TextNodeProps) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(String(data ?? ''));
    const inputRef = useRef<HTMLInputElement>(null);
    const { hoveredPath, setDraggedItem, clearDraggedItem, matchedPaths } = useTreeContext();

    const isHovered = hoveredPath === path;
    const isMatched = matchedPaths.has(path);

    const handleClick = () => {
        if (!readonly) {
            setIsEditing(true);
            setEditValue(String(data ?? ''));
        }
    };

    const handleSave = () => {
        let newValue: any = editValue;
        
        // Try to parse as number or boolean if applicable
        if (editValue === 'true') {
            newValue = true;
        } else if (editValue === 'false') {
            newValue = false;
        } else if (editValue === 'null') {
            newValue = null;
        } else if (!isNaN(Number(editValue)) && editValue.trim() !== '') {
            newValue = Number(editValue);
        }
        
        onUpdate(newValue);
        setIsEditing(false);
    };

    const handleCancel = () => {
        setEditValue(String(data ?? ''));
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSave();
        } else if (e.key === 'Escape') {
            handleCancel();
        }
    };

    const getValueDisplay = () => {
        if (data === null) return 'null';
        if (data === undefined) return 'undefined';
        if (typeof data === 'boolean') return data.toString();
        if (typeof data === 'number') return data.toString();
        if (typeof data === 'string') return `"${data}"`;
        return String(data);
    };

    const getValueTypeClass = () => {
        if (data === null || data === undefined) return 'text-[#6B7280]';
        if (typeof data === 'boolean') return 'text-[#10B981]';
        if (typeof data === 'number') return 'text-[#F59E0B]';
        if (typeof data === 'string') return 'text-[#374151]';
        return 'text-[#374151]';
    };

    const handleDragStart = (e: React.DragEvent) => {
        if (readonly || !onDelete) return;
        
        e.stopPropagation();
        setDraggedItem(data, path, parentKey ?? null, parentType, onDelete);
        e.dataTransfer.effectAllowed = 'move';
        
        // Create drag preview
        const preview = document.createElement('div');
        preview.className = 'px-3 py-2 bg-[#1F2937] text-[#E5E7EB] rounded-md border border-[#374151] text-sm font-mono shadow-lg';
        preview.textContent = getValueDisplay();
        preview.style.position = 'absolute';
        preview.style.top = '-1000px';
        preview.style.left = '-1000px';
        document.body.appendChild(preview);
        
        e.dataTransfer.setDragImage(preview, 10, 10);
        
        setTimeout(() => {
            if (document.body.contains(preview)) {
                document.body.removeChild(preview);
            }
        }, 0);
    };

    const handleDragEnd = () => {
        clearDraggedItem();
    };

    React.useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    return (
        <div 
            className="flex items-center w-full group" 
            data-path={path}
        >
            {/* File icon */}
            <svg 
                className="w-4 h-4 text-[#9CA3AF] mr-3 flex-shrink-0 mt-0.5" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
            >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            
            {/* Value content */}
            <div className="flex-1 min-w-0">
                {isEditing ? (
                    <input
                        ref={inputRef}
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleSave}
                        onKeyDown={handleKeyDown}
                        className="w-full px-2 py-1 text-sm bg-white border border-[#D1D5DB] rounded focus:outline-none focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent"
                    />
                ) : (
                    <span
                        className={`text-sm cursor-pointer hover:bg-[#F3F4F6] px-2 py-1 rounded transition-colors ${getValueTypeClass()} ${
                            isMatched ? 'bg-[#FEF3C7] ring-2 ring-[#F59E0B]' : ''
                        } ${!readonly && onDelete ? 'draggable' : ''}`}
                        onClick={handleClick}
                        draggable={!readonly && !!onDelete}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        title={readonly ? undefined : 'Click to edit'}
                    >
                        {getValueDisplay()}
                    </span>
                )}
            </div>
        </div>
    );
};

export default TextNode;