'use client'
import React, { createContext, useContext, useState, ReactNode } from 'react';

type TreeContextType = {
    // Expansion state
    expandedNodes: Set<string>;
    toggleExpansion: (path: string) => void;
    expandNode: (path: string) => void;
    collapseNode: (path: string) => void;
    
    // Hover state
    hoveredPath: string | null;
    setHoveredPath: (path: string | null) => void;
    
    // Selection state
    selectedPath: string | null;
    setSelectedPath: (path: string | null) => void;
    
    // Drag state
    draggedItem: {
        data: any;
        path: string;
        key: string | number | null;
        parentType: 'dict' | 'list' | 'root';
        sourceDeleteCallback?: () => void;
    } | null;
    setDraggedItem: (
        data: any, 
        path: string, 
        key: string | number | null, 
        parentType: 'dict' | 'list' | 'root',
        deleteCallback?: () => void
    ) => void;
    clearDraggedItem: () => void;
    
    // Search state
    searchTerm: string;
    setSearchTerm: (term: string) => void;
    matchedPaths: Set<string>;
    setMatchedPaths: (paths: Set<string>) => void;
};

const TreeContext = createContext<TreeContextType | null>(null);

export const useTreeContext = () => {
    const context = useContext(TreeContext);
    if (!context) {
        throw new Error('useTreeContext must be used within a TreeProvider');
    }
    return context;
};

type TreeProviderProps = {
    children: ReactNode;
};

export const TreeProvider = ({ children }: TreeProviderProps) => {
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set([''])); // Root is expanded by default
    const [hoveredPath, setHoveredPath] = useState<string | null>(null);
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [draggedItem, setDraggedItemState] = useState<TreeContextType['draggedItem']>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [matchedPaths, setMatchedPaths] = useState<Set<string>>(new Set());

    const toggleExpansion = (path: string) => {
        setExpandedNodes(prev => {
            const newSet = new Set(prev);
            if (newSet.has(path)) {
                newSet.delete(path);
            } else {
                newSet.add(path);
            }
            return newSet;
        });
    };

    const expandNode = (path: string) => {
        setExpandedNodes(prev => new Set(prev).add(path));
    };

    const collapseNode = (path: string) => {
        setExpandedNodes(prev => {
            const newSet = new Set(prev);
            newSet.delete(path);
            return newSet;
        });
    };

    const setDraggedItem = (
        data: any, 
        path: string, 
        key: string | number | null, 
        parentType: 'dict' | 'list' | 'root',
        deleteCallback?: () => void
    ) => {
        setDraggedItemState({
            data,
            path,
            key,
            parentType,
            sourceDeleteCallback: deleteCallback
        });
    };

    const clearDraggedItem = () => {
        setDraggedItemState(null);
    };

    const value: TreeContextType = {
        expandedNodes,
        toggleExpansion,
        expandNode,
        collapseNode,
        hoveredPath,
        setHoveredPath,
        selectedPath,
        setSelectedPath,
        draggedItem,
        setDraggedItem,
        clearDraggedItem,
        searchTerm,
        setSearchTerm,
        matchedPaths,
        setMatchedPaths
    };

    return (
        <TreeContext.Provider value={value}>
            {children}
        </TreeContext.Provider>
    );
};