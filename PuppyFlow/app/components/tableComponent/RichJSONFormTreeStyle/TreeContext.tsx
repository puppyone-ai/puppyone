'use client';
import React, { createContext, useContext, useState, ReactNode } from 'react';

interface TreeContextValue {
  expandedNodes: Set<string>;
  selectedNode: string | null;
  toggleExpanded: (path: string) => void;
  setSelected: (path: string | null) => void;
  isExpanded: (path: string) => boolean;
  isSelected: (path: string) => boolean;
}

const TreeContext = createContext<TreeContextValue | undefined>(undefined);

interface TreeProviderProps {
  children: ReactNode;
}

export const TreeProvider: React.FC<TreeProviderProps> = ({ children }) => {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(
    new Set([''])
  ); // Root is expanded by default
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const toggleExpanded = (path: string) => {
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

  const setSelected = (path: string | null) => {
    setSelectedNode(path);
  };

  const isExpanded = (path: string) => {
    return expandedNodes.has(path);
  };

  const isSelected = (path: string) => {
    return selectedNode === path;
  };

  return (
    <TreeContext.Provider
      value={{
        expandedNodes,
        selectedNode,
        toggleExpanded,
        setSelected,
        isExpanded,
        isSelected,
      }}
    >
      {children}
    </TreeContext.Provider>
  );
};

export const useTree = (): TreeContextValue => {
  const context = useContext(TreeContext);
  if (context === undefined) {
    throw new Error('useTree must be used within a TreeProvider');
  }
  return context;
};
