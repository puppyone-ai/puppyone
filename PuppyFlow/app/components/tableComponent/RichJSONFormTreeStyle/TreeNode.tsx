'use client';
import React, { useState, useRef } from 'react';
import { useTree } from './TreeContext';
import TreeValueEditor from './TreeValueEditor';

interface TreeNodeProps {
  data: any;
  path: string;
  level: number;
  readonly?: boolean;
  onUpdate: (newData: any) => void;
  preventParentDrag: () => void;
  allowParentDrag: () => void;
  nodeKey?: string | number;
  onDelete?: () => void;
}

const TreeNode: React.FC<TreeNodeProps> = ({
  data,
  path,
  level,
  readonly = false,
  onUpdate,
  preventParentDrag,
  allowParentDrag,
  nodeKey,
  onDelete,
}) => {
  const { isExpanded, toggleExpanded, isSelected, setSelected } = useTree();
  const [isEditing, setIsEditing] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const isObject =
    data !== null && typeof data === 'object' && !Array.isArray(data);
  const isArray = Array.isArray(data);
  const isExpandable = isObject || isArray;
  const isCurrentlyExpanded = isExpanded(path);
  const isCurrentlySelected = isSelected(path);

  // Get the type and preview of the value
  const getValueTypeAndPreview = () => {
    if (data === null)
      return { type: 'null', preview: 'null', color: '#569cd6' };
    if (data === undefined)
      return { type: 'undefined', preview: 'undefined', color: '#569cd6' };

    switch (typeof data) {
      case 'string':
        return {
          type: 'string',
          preview:
            data.length > 50 ? `"${data.substring(0, 47)}..."` : `"${data}"`,
          color: '#ce9178',
        };
      case 'number':
        return { type: 'number', preview: data.toString(), color: '#b5cea8' };
      case 'boolean':
        return { type: 'boolean', preview: data.toString(), color: '#569cd6' };
      case 'object':
        if (isArray) {
          return {
            type: 'array',
            preview: `Array(${data.length})`,
            color: '#cccccc',
          };
        }
        return {
          type: 'object',
          preview: `Object{${Object.keys(data).length}}`,
          color: '#cccccc',
        };
      default:
        return { type: 'unknown', preview: String(data), color: '#cccccc' };
    }
  };

  const { type, preview, color } = getValueTypeAndPreview();

  // Handle click on the node
  const handleNodeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected(path);

    if (isExpandable) {
      toggleExpanded(path);
    } else if (!readonly) {
      setIsEditing(true);
    }
  };

  // Handle context menu
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowContextMenu(true);
    setSelected(path);
  };

  // Add new property/item
  const addNewItem = () => {
    if (readonly) return;

    if (isArray) {
      const newArray = [...data, null];
      onUpdate(newArray);
    } else if (isObject) {
      let newKey = 'newProperty';
      let counter = 1;
      while (data.hasOwnProperty(newKey)) {
        newKey = `newProperty${counter}`;
        counter++;
      }
      const newObject = { ...data, [newKey]: null };
      onUpdate(newObject);
    }
    setShowContextMenu(false);
  };

  // Delete this node
  const deleteNode = () => {
    if (onDelete) {
      onDelete();
    }
    setShowContextMenu(false);
  };

  // Update child value
  const updateChildValue = (childKey: string | number, newValue: any) => {
    if (isArray) {
      const newArray = [...data];
      newArray[childKey as number] = newValue;
      onUpdate(newArray);
    } else if (isObject) {
      const newObject = { ...data, [childKey]: newValue };
      onUpdate(newObject);
    }
  };

  // Delete child
  const deleteChild = (childKey: string | number) => {
    if (isArray) {
      const newArray = data.filter(
        (_: any, index: number) => index !== childKey
      );
      onUpdate(newArray);
    } else if (isObject) {
      const newObject = { ...data };
      delete newObject[childKey as string];
      onUpdate(newObject);
    }
  };

  // Render expand/collapse icon
  const renderExpandIcon = () => {
    if (!isExpandable) {
      return <div className='w-4 h-4' />;
    }

    return (
      <button
        onClick={e => {
          e.stopPropagation();
          toggleExpanded(path);
        }}
        className='w-4 h-4 flex items-center justify-center text-[#cccccc] hover:text-white transition-colors'
      >
        <svg
          className={`w-3 h-3 transition-transform ${isCurrentlyExpanded ? 'rotate-90' : ''}`}
          fill='currentColor'
          viewBox='0 0 20 20'
        >
          <path
            fillRule='evenodd'
            d='M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z'
            clipRule='evenodd'
          />
        </svg>
      </button>
    );
  };

  // Render the key (for object properties)
  const renderKey = () => {
    if (nodeKey !== undefined) {
      return (
        <span className='text-[#9cdcfe] mr-2'>
          {isArray ? `[${nodeKey}]` : `"${nodeKey}"`}:
        </span>
      );
    }
    return null;
  };

  const indentWidth = level * 16;

  return (
    <div>
      {/* Main node row */}
      <div
        className={`flex items-center py-0.5 px-2 cursor-pointer hover:bg-[#2a2d2e] relative ${
          isCurrentlySelected ? 'bg-[#37373d]' : ''
        }`}
        style={{ paddingLeft: `${8 + indentWidth}px` }}
        onClick={handleNodeClick}
        onContextMenu={handleContextMenu}
      >
        {/* Expand/collapse icon */}
        {renderExpandIcon()}

        {/* Key (if applicable) */}
        {renderKey()}

        {/* Value or preview */}
        {isEditing && !isExpandable ? (
          <TreeValueEditor
            value={data}
            onSave={newValue => {
              onUpdate(newValue);
              setIsEditing(false);
            }}
            onCancel={() => setIsEditing(false)}
          />
        ) : (
          <span className='text-sm font-mono' style={{ color }}>
            {preview}
          </span>
        )}

        {/* Context menu */}
        {showContextMenu && (
          <>
            <div
              className='fixed inset-0 z-10'
              onClick={() => setShowContextMenu(false)}
            />
            <div
              ref={contextMenuRef}
              className='absolute right-0 mt-1 w-48 bg-[#2d2d30] border border-[#3c3c3c] rounded shadow-lg z-20 py-1'
            >
              {!readonly && isExpandable && (
                <button
                  onClick={addNewItem}
                  className='w-full text-left px-3 py-2 text-sm text-[#cccccc] hover:bg-[#37373d] transition-colors'
                >
                  Add {isArray ? 'Item' : 'Property'}
                </button>
              )}
              {!readonly && onDelete && (
                <button
                  onClick={deleteNode}
                  className='w-full text-left px-3 py-2 text-sm text-[#f48771] hover:bg-[#37373d] transition-colors'
                >
                  Delete
                </button>
              )}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(data, null, 2));
                  setShowContextMenu(false);
                }}
                className='w-full text-left px-3 py-2 text-sm text-[#cccccc] hover:bg-[#37373d] transition-colors'
              >
                Copy Value
              </button>
            </div>
          </>
        )}
      </div>

      {/* Children (if expanded) */}
      {isExpandable && isCurrentlyExpanded && (
        <div>
          {isArray
            ? data.map((item: any, index: number) => (
                <TreeNode
                  key={`${path}[${index}]`}
                  data={item}
                  path={`${path}[${index}]`}
                  level={level + 1}
                  readonly={readonly}
                  onUpdate={newValue => updateChildValue(index, newValue)}
                  onDelete={() => deleteChild(index)}
                  preventParentDrag={preventParentDrag}
                  allowParentDrag={allowParentDrag}
                  nodeKey={index}
                />
              ))
            : Object.entries(data).map(([key, value]) => (
                <TreeNode
                  key={`${path}.${key}`}
                  data={value}
                  path={`${path}.${key}`}
                  level={level + 1}
                  readonly={readonly}
                  onUpdate={newValue => updateChildValue(key, newValue)}
                  onDelete={() => deleteChild(key)}
                  preventParentDrag={preventParentDrag}
                  allowParentDrag={allowParentDrag}
                  nodeKey={key}
                />
              ))}
        </div>
      )}
    </div>
  );
};

export default TreeNode;
