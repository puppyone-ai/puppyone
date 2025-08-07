'use client'
import React, { useState } from 'react';
import { useTreeContext } from './TreeContext';
import TreeNode from './TreeNode';
import TypeSelector from './TypeSelector';

type ArrayNodeProps = {
    data: any[];
    path: string;
    parentKey?: string | number;
    parentType?: 'dict' | 'list' | 'root';
    depth?: number;
    readonly?: boolean;
    onUpdate: (newData: any) => void;
    onDelete?: () => void;
};

const ArrayNode = ({
    data,
    path,
    parentKey,
    parentType = 'root',
    depth = 0,
    readonly = false,
    onUpdate,
    onDelete
}: ArrayNodeProps) => {
    const { expandedNodes, toggleExpansion, setDraggedItem, clearDraggedItem, draggedItem } = useTreeContext();
    const [showAddItemSelector, setShowAddItemSelector] = useState(false);
    
    const isExpanded = expandedNodes.has(path);
    const hasItems = data.length > 0;

    const handleToggleExpansion = () => {
        toggleExpansion(path);
    };

    const handleAddItem = (type: 'text' | 'dict' | 'list') => {
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
        
        const newData = [...data, newValue];
        onUpdate(newData);
        setShowAddItemSelector(false);
    };

    const handleUpdateItem = (index: number, newValue: any) => {
        const newData = [...data];
        newData[index] = newValue;
        onUpdate(newData);
    };

    const handleDeleteItem = (indexToDelete: number) => {
        const newData = data.filter((_, index) => index !== indexToDelete);
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

    const handleDragOver = (e: React.DragEvent, index?: number, position?: 'before' | 'after') => {
        if (!draggedItem || readonly) return;
        
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        
        if (index !== undefined && position) {
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

    const handleDrop = (e: React.DragEvent, dropIndex?: number, position?: 'before' | 'after') => {
        if (!draggedItem || readonly) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        const { data: draggedData, sourceDeleteCallback } = draggedItem;
        
        let newData: any[];
        
        if (dropIndex !== undefined && position) {
            // Insert at specific position
            newData = [...data];
            const insertIndex = position === 'before' ? dropIndex : dropIndex + 1;
            newData.splice(insertIndex, 0, draggedData);
        } else {
            // Add at end
            newData = [...data, draggedData];
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
                    className="w-4 h-4 mr-2 flex items-center justify-center text-[#F59E0B] hover:text-[#FBBF24] transition-colors flex-shrink-0"
                >
                    {hasItems ? (
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
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                        </svg>
                    )}
                </button>

                {/* Array label */}
                <div
                    className={`flex items-center text-sm text-[#F59E0B] font-medium ${
                        !readonly && onDelete ? 'cursor-move' : ''
                    }`}
                    draggable={!readonly && !!onDelete}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                >
                    Array {hasItems && (
                        <span className="ml-1 text-[#6B7280] text-xs">
                            ({data.length} {data.length === 1 ? 'item' : 'items'})
                        </span>
                    )}
                </div>

                {/* Add item button */}
                {!readonly && isExpanded && (
                    <button
                        onClick={() => setShowAddItemSelector(!showAddItemSelector)}
                        className="ml-3 w-6 h-6 rounded-md border border-[#F59E0B]/30 bg-[#F59E0B]/5 hover:bg-[#F59E0B]/10 text-[#F59E0B] hover:text-[#D97706] transition-all duration-200 opacity-0 group-hover:opacity-100 flex items-center justify-center shadow-sm"
                        title="Add item"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                    </button>
                )}
            </div>

            {/* Add item type selector */}
            {showAddItemSelector && !readonly && (
                <div className="mt-2 ml-6 p-3 bg-[#FEF3C7] rounded-lg border border-[#F59E0B]/20">
                    <TypeSelector
                        onTypeSelect={handleAddItem}
                        onCancel={() => setShowAddItemSelector(false)}
                        size="compact"
                    />
                </div>
            )}

            {/* Children */}
            {isExpanded && (
                <div 
                    className={`ml-6 ${hasItems ? 'mt-1' : 'mt-2'} ${
                        !hasItems && draggedItem ? 'border-2 border-dashed border-[#F59E0B] bg-[#F59E0B]/5 rounded-lg p-4' : ''
                    }`}
                    onDragOver={!hasItems ? handleDragOver : undefined}
                    onDrop={!hasItems ? handleDrop : undefined}
                >
                    {hasItems ? (
                        data.map((item, index) => {
                            const childPath = `${path}[${index}]`;
                            const isLast = index === data.length - 1;
                            const showDropIndicatorBefore = dragOverIndex === index && dragOverPosition === 'before';
                            const showDropIndicatorAfter = dragOverIndex === index && dragOverPosition === 'after';
                            
                            return (
                                <React.Fragment key={index}>
                                    {/* Drop indicator - Before */}
                                    {showDropIndicatorBefore && (
                                        <div className="h-0.5 bg-[#F59E0B] rounded-full mx-2 shadow-md">
                                            <div className="absolute left-0 w-2 h-2 bg-[#F59E0B] rounded-full -mt-0.5 shadow-md"></div>
                                        </div>
                                    )}
                                    
                                    <div 
                                        className="flex relative"
                                        onDragOver={(e) => {
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const midpoint = rect.top + rect.height / 2;
                                            const position = e.clientY < midpoint ? 'before' : 'after';
                                            handleDragOver(e, index, position);
                                        }}
                                        onDragLeave={handleDragLeave}
                                        onDrop={(e) => handleDrop(e, index, dragOverPosition || 'after')}
                                    >
                                        {/* Index */}
                                        <div className="flex-shrink-0 w-20 pr-3">
                                            <span className="inline-block px-2 py-0.5 text-xs text-[#D97706] bg-[#FEF3C7] rounded-md font-semibold border border-[#F59E0B]/20">
                                                [{index}]
                                            </span>
                                        </div>
                                        
                                        {/* Value */}
                                        <div className="flex-1 min-w-0">
                                            <TreeNode
                                                data={item}
                                                path={childPath}
                                                parentKey={index}
                                                parentType="list"
                                                depth={depth + 1}
                                                isLast={isLast}
                                                readonly={readonly}
                                                onUpdate={(newValue) => handleUpdateItem(index, newValue)}
                                                onDelete={() => handleDeleteItem(index)}
                                            />
                                        </div>
                                    </div>
                                    
                                    {/* Drop indicator - After */}
                                    {showDropIndicatorAfter && (
                                        <div className="h-0.5 bg-[#F59E0B] rounded-full mx-2 shadow-md">
                                            <div className="absolute left-0 w-2 h-2 bg-[#F59E0B] rounded-full -mt-0.5 shadow-md"></div>
                                        </div>
                                    )}
                                </React.Fragment>
                            );
                        })
                    ) : (
                        <div className="text-sm text-[#6B7280] italic py-2">
                            {draggedItem ? 'Drop item here to add element' : 'Empty array'}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default ArrayNode;