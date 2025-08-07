'use client'
import React, { useState } from 'react';
import { useTreeContext } from './TreeContext';
import TreeNode from './TreeNode';
import TypeSelector from './TypeSelector';

type ObjectNodeProps = {
    data: Record<string, any>;
    path: string;
    parentKey?: string | number;
    parentType?: 'dict' | 'list' | 'root';
    depth?: number;
    readonly?: boolean;
    onUpdate: (newData: any) => void;
    onDelete?: () => void;
};

const ObjectNode = ({
    data,
    path,
    parentKey,
    parentType = 'root',
    depth = 0,
    readonly = false,
    onUpdate,
    onDelete
}: ObjectNodeProps) => {
    const { expandedNodes, toggleExpansion, setDraggedItem, clearDraggedItem, draggedItem } = useTreeContext();
    const [showAddKeySelector, setShowAddKeySelector] = useState(false);
    
    const isExpanded = expandedNodes.has(path);
    const keys = Object.keys(data);
    const hasKeys = keys.length > 0;

    const generateRandomKey = () => {
        const existingKeys = Object.keys(data);
        let newKey = `key_${Math.random().toString(36).substr(2, 6)}`;
        
        while (existingKeys.includes(newKey)) {
            newKey = `key_${Math.random().toString(36).substr(2, 6)}`;
        }
        
        return newKey;
    };

    const createEmptyElement = () => ({
        __isEmpty: true
    });

    const handleToggleExpansion = () => {
        toggleExpansion(path);
    };

    const handleAddKey = (type: 'text' | 'dict' | 'list') => {
        const newKey = generateRandomKey();
        let newValue;
        
        switch (type) {
            case 'text':
                newValue = '';
                break;
            case 'dict':
                newValue = {};
                break;
            case 'list':
                newValue = [];
                break;
        }
        
        const newData = {
            ...data,
            [newKey]: newValue
        };
        
        onUpdate(newData);
        setShowAddKeySelector(false);
    };

    const handleUpdateKey = (key: string, newValue: any) => {
        const newData = {
            ...data,
            [key]: newValue
        };
        onUpdate(newData);
    };

    const handleDeleteKey = (keyToDelete: string) => {
        const newData = { ...data };
        delete newData[keyToDelete];
        onUpdate(newData);
    };

    const handleDragStart = (e: React.DragEvent) => {
        if (readonly || !onDelete) return;
        
        e.stopPropagation();
        setDraggedItem(data, path, parentKey ?? null, parentType, onDelete);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragEnd = () => {
        clearDraggedItem();
    };

    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const [dragOverPosition, setDragOverPosition] = useState<'before' | 'after' | null>(null);

    const handleDragOver = (e: React.DragEvent, key?: string, position?: 'before' | 'after') => {
        if (!draggedItem || readonly) return;
        
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        
        if (key && position) {
            const index = keys.indexOf(key);
            setDragOverIndex(index);
            setDragOverPosition(position);
        }
    };

    const handleDragLeave = (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragOverIndex(null);
            setDragOverPosition(null);
        }
    };

    const handleDrop = (e: React.DragEvent, dropKey?: string, position?: 'before' | 'after') => {
        if (!draggedItem || readonly) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        const { data: draggedData, sourceDeleteCallback } = draggedItem;
        
        // Generate new key for dropped item
        const newKey = generateRandomKey();
        
        let newData: Record<string, any>;
        
        if (dropKey && position) {
            // Insert at specific position
            newData = {};
            const keysArray = Object.keys(data);
            const dropIndex = keysArray.indexOf(dropKey);
            
            keysArray.forEach((key, index) => {
                if (position === 'before' && index === dropIndex) {
                    newData[newKey] = draggedData;
                }
                newData[key] = data[key];
                if (position === 'after' && index === dropIndex) {
                    newData[newKey] = draggedData;
                }
            });
        } else {
            // Add at end
            newData = {
                ...data,
                [newKey]: draggedData
            };
        }
        
        onUpdate(newData);
        
        // Call source delete callback if available
        if (sourceDeleteCallback) {
            sourceDeleteCallback();
        }
        
        clearDraggedItem();
        setDragOverIndex(null);
        setDragOverPosition(null);
    };

    return (
        <div className="w-full">
            {/* Node header */}
            <div className="flex items-center group">
                {/* Expand/Collapse button */}
                <button
                    onClick={handleToggleExpansion}
                    className="w-4 h-4 mr-2 flex items-center justify-center text-[#8B5CF6] hover:text-[#A78BFA] transition-colors flex-shrink-0"
                >
                    {hasKeys ? (
                        isExpanded ? (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        ) : (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        )
                    ) : (
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                    )}
                </button>

                {/* Object label */}
                <div
                    className={`flex items-center text-sm text-[#8B5CF6] font-medium ${
                        !readonly && onDelete ? 'cursor-move' : ''
                    }`}
                    draggable={!readonly && !!onDelete}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                >
                    Object {hasKeys && (
                        <span className="ml-1 text-[#6B7280] text-xs">
                            ({keys.length} {keys.length === 1 ? 'item' : 'items'})
                        </span>
                    )}
                </div>

                {/* Add key button */}
                {!readonly && isExpanded && (
                    <button
                        onClick={() => setShowAddKeySelector(!showAddKeySelector)}
                        className="ml-3 w-6 h-6 rounded-md border border-[#8B5CF6]/30 bg-[#8B5CF6]/5 hover:bg-[#8B5CF6]/10 text-[#8B5CF6] hover:text-[#7C3AED] transition-all duration-200 opacity-0 group-hover:opacity-100 flex items-center justify-center shadow-sm"
                        title="Add property"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                    </button>
                )}
            </div>

            {/* Add key type selector */}
            {showAddKeySelector && !readonly && (
                <div className="mt-2 ml-6 p-3 bg-[#F9FAFB] rounded-lg border border-[#E5E7EB]">
                    <TypeSelector
                        onTypeSelect={handleAddKey}
                        onCancel={() => setShowAddKeySelector(false)}
                        size="compact"
                    />
                </div>
            )}

            {/* Children */}
            {isExpanded && (
                <div 
                    className={`ml-6 ${hasKeys ? 'mt-1' : 'mt-2'} ${
                        !hasKeys && draggedItem ? 'border-2 border-dashed border-[#8B5CF6] bg-[#8B5CF6]/5 rounded-lg p-4' : ''
                    }`}
                    onDragOver={!hasKeys ? handleDragOver : undefined}
                    onDrop={!hasKeys ? handleDrop : undefined}
                >
                    {hasKeys ? (
                        keys.map((key, index) => {
                            const childPath = path ? `${path}.${key}` : key;
                            const isLast = index === keys.length - 1;
                            const showDropIndicatorBefore = dragOverIndex === index && dragOverPosition === 'before';
                            const showDropIndicatorAfter = dragOverIndex === index && dragOverPosition === 'after';
                            
                            return (
                                <React.Fragment key={key}>
                                    {/* Drop indicator - Before */}
                                    {showDropIndicatorBefore && (
                                        <div className="h-0.5 bg-[#3B82F6] rounded-full mx-2 shadow-md">
                                            <div className="absolute left-0 w-2 h-2 bg-[#3B82F6] rounded-full -mt-0.5 shadow-md"></div>
                                        </div>
                                    )}
                                    
                                    <div 
                                        className="flex relative"
                                        onDragOver={(e) => {
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const midpoint = rect.top + rect.height / 2;
                                            const position = e.clientY < midpoint ? 'before' : 'after';
                                            handleDragOver(e, key, position);
                                        }}
                                        onDragLeave={handleDragLeave}
                                        onDrop={(e) => handleDrop(e, key, dragOverPosition || 'after')}
                                    >
                                        {/* Key name */}
                                        <div className="flex-shrink-0 min-w-[120px] pr-3">
                                            <span className="text-sm text-[#7C3AED] font-semibold truncate block cursor-pointer hover:text-[#6B21A8] transition-colors" title={key}>
                                                {key}:
                                            </span>
                                        </div>
                                        
                                        {/* Value */}
                                        <div className="flex-1 min-w-0">
                                            <TreeNode
                                                data={data[key]}
                                                path={childPath}
                                                parentKey={key}
                                                parentType="dict"
                                                depth={depth + 1}
                                                isLast={isLast}
                                                readonly={readonly}
                                                onUpdate={(newValue) => handleUpdateKey(key, newValue)}
                                                onDelete={() => handleDeleteKey(key)}
                                            />
                                        </div>
                                    </div>
                                    
                                    {/* Drop indicator - After */}
                                    {showDropIndicatorAfter && (
                                        <div className="h-0.5 bg-[#3B82F6] rounded-full mx-2 shadow-md">
                                            <div className="absolute left-0 w-2 h-2 bg-[#3B82F6] rounded-full -mt-0.5 shadow-md"></div>
                                        </div>
                                    )}
                                </React.Fragment>
                            );
                        })
                    ) : (
                        <div className="text-sm text-[#6B7280] italic py-2">
                            {draggedItem ? 'Drop item here to add property' : 'Empty object'}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default ObjectNode;