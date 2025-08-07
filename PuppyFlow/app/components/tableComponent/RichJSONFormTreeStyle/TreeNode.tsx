'use client'
import React, { useState } from 'react';
import { useTreeContext } from './TreeContext';
import TextNode from './TextNode';
import ObjectNode from './ObjectNode';
import ArrayNode from './ArrayNode';
import EmptyNode from './EmptyNode';
import ContextMenu from './ContextMenu';

type TreeNodeProps = {
    data: any;
    path: string;
    parentKey?: string | number;
    parentType?: 'dict' | 'list' | 'root';
    depth?: number;
    isLast?: boolean;
    readonly?: boolean;
    onUpdate: (newData: any) => void;
    onDelete?: () => void;
};

const TreeNode = ({
    data,
    path,
    parentKey,
    parentType = 'root',
    depth = 0,
    isLast = true,
    readonly = false,
    onUpdate,
    onDelete
}: TreeNodeProps) => {
    const { hoveredPath, setHoveredPath } = useTreeContext();
    const [contextMenu, setContextMenu] = useState<{x: number, y: number} | null>(null);

    const isHovered = hoveredPath === path;

    // Determine node type
    const getNodeType = (value: any): 'text' | 'object' | 'array' | 'empty' => {
        if (value === null || value === undefined || (value && typeof value === 'object' && value.__isEmpty)) {
            return 'empty';
        }
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return 'text';
        }
        if (Array.isArray(value)) {
            return 'array';
        }
        if (typeof value === 'object') {
            return 'object';
        }
        return 'text';
    };

    const nodeType = getNodeType(data);

    // Connection line styles
    const getConnectionLineStyles = () => {
        if (depth === 0) return [];
        
        const baseStyles = "absolute border-[#E5E7EB]";
        const styles = [];

        // Vertical line connecting to parent
        if (depth > 0) {
            styles.push(
                <div
                    key="vertical"
                    className={`${baseStyles} border-l ${isLast ? 'h-4' : 'h-full'}`}
                    style={{ 
                        left: `${(depth - 1) * 24 + 12}px`,
                        top: 0,
                        width: '1px'
                    }}
                />
            );
        }

        // Horizontal line to node
        if (depth > 0) {
            styles.push(
                <div
                    key="horizontal"
                    className={`${baseStyles} border-t`}
                    style={{ 
                        left: `${(depth - 1) * 24 + 12}px`,
                        top: '14px',
                        width: '12px',
                        height: '1px'
                    }}
                />
            );
        }

        return styles;
    };

    const handleMouseEnter = () => {
        setHoveredPath(path);
    };

    const handleMouseLeave = () => {
        if (hoveredPath === path) {
            setHoveredPath(null);
        }
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        if (readonly) return;
        
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY });
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(JSON.stringify(data, null, 2));
        setContextMenu(null);
    };

    const handleCopyPath = () => {
        navigator.clipboard.writeText(path);
        setContextMenu(null);
    };

    const handleClear = () => {
        const createEmpty = () => ({ __isEmpty: true });
        onUpdate(createEmpty());
        setContextMenu(null);
    };

    const handleChangeType = (type: 'text' | 'dict' | 'list') => {
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
        onUpdate(newValue);
        setContextMenu(null);
    };

    const canAddChild = nodeType === 'object' || nodeType === 'array';
    const canDelete = !!onDelete;

    const renderNodeContent = () => {
        const commonProps = {
            data,
            path,
            parentKey,
            parentType,
            depth,
            readonly,
            onUpdate,
            onDelete
        };

        switch (nodeType) {
            case 'text':
                return <TextNode {...commonProps} />;
            case 'object':
                return <ObjectNode {...commonProps} />;
            case 'array':
                return <ArrayNode {...commonProps} />;
            case 'empty':
                return <EmptyNode {...commonProps} />;
            default:
                return <TextNode {...commonProps} />;
        }
    };

    return (
        <div className="relative">
            {/* Connection lines */}
            {getConnectionLineStyles()}
            
            {/* Node content */}
            <div
                className={`relative flex items-start transition-all duration-150 ${
                    isHovered ? 'bg-[#F9FAFB]' : ''
                }`}
                style={{ 
                    paddingLeft: `${depth * 24}px`,
                    minHeight: '28px'
                }}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                onContextMenu={handleContextMenu}
            >
                {renderNodeContent()}
            </div>

            {/* Context Menu */}
            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    path={path}
                    onClose={() => setContextMenu(null)}
                    onCopy={handleCopy}
                    onCopyPath={handleCopyPath}
                    onClear={handleClear}
                    onDelete={canDelete ? onDelete : undefined}
                    onChangeType={handleChangeType}
                    canAddChild={canAddChild}
                    canDelete={canDelete}
                />
            )}
        </div>
    );
};

export default TreeNode;