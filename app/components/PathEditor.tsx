'use client';
import React, { useState } from 'react';

type NodeType = 'key' | 'num';

interface PathNode {
  id: number;
  type: NodeType;
  value: string;
  children: PathNode[];
}

const PathEditor: React.FC = () => {
  const [paths, setPaths] = useState<PathNode[]>([
    {
      id: 1,
      type: 'key',
      value: '',
      children: [],
    },
  ]);

  // Add a new child node to a parent node
  const addNode = (parentId: number) => {
    setPaths((prevPaths) => {
      const newPaths = JSON.parse(JSON.stringify(prevPaths));
      const findAndAddNode = (nodes: PathNode[]) => {
        for (let node of nodes) {
          if (node.id === parentId) {
            node.children.push({
              id: Date.now(),
              type: Math.random() > 0.5 ? 'num' : 'key',
              value: '',
              children: [],
            });
            return true;
          }
          if (node.children.length && findAndAddNode(node.children)) {
            return true;
          }
        }
        return false;
      };
      findAndAddNode(newPaths);
      return newPaths;
    });
  };

  // Delete a node from the tree
  const deleteNode = (nodeId: number) => {
    setPaths((prevPaths) => {
      const newPaths = JSON.parse(JSON.stringify(prevPaths));
      const findAndDeleteNode = (nodes: PathNode[]) => {
        for (let i = 0; i < nodes.length; i++) {
          if (nodes[i].id === nodeId) {
            nodes.splice(i, 1);
            return true;
          }
          if (nodes[i].children.length && findAndDeleteNode(nodes[i].children)) {
            return true;
          }
        }
        return false;
      };
      findAndDeleteNode(newPaths);
      return newPaths;
    });
  };

  // Update a node's value
  const updateNodeValue = (nodeId: number, value: string) => {
    setPaths((prevPaths) => {
      const newPaths = JSON.parse(JSON.stringify(prevPaths));
      const findAndUpdateNode = (nodes: PathNode[]) => {
        for (let node of nodes) {
          if (node.id === nodeId) {
            node.value = value;
            return true;
          }
          if (node.children.length && findAndUpdateNode(node.children)) {
            return true;
          }
        }
        return false;
      };
      findAndUpdateNode(newPaths);
      return newPaths;
    });
  };

  // Toggle node type between 'key' and 'num'
  const toggleNodeType = (nodeId: number) => {
    setPaths((prevPaths) => {
      const newPaths = JSON.parse(JSON.stringify(prevPaths));
      const findAndToggleNode = (nodes: PathNode[]) => {
        for (let node of nodes) {
          if (node.id === nodeId) {
            node.type = node.type === 'key' ? 'num' : 'key';
            return true;
          }
          if (node.children.length && findAndToggleNode(node.children)) {
            return true;
          }
        }
        return false;
      };
      findAndToggleNode(newPaths);
      return newPaths;
    });
  };

  // Recursively render a node and its children
  const renderNode = (node: PathNode, level = 0) => {
    return (
      <div key={node.id} className="relative group">
        <div
          className={`
            flex items-center gap-4 p-3 rounded-lg bg-[#252525] border border-[#6D7177]/30 mb-2
            ${level > 0 ? 'relative before:absolute before:top-1/2 before:-left-[20px] before:w-[20px] before:h-px before:bg-[#6D7177]' : ''}
            ${level > 0 ? 'relative after:absolute after:-left-[20px] after:top-[-28px] after:w-px after:h-[calc(50%+28px)] after:bg-[#6D7177]' : ''}
          `}
          style={{ marginLeft: `${level * 40}px` }}
        >
          <button
            onClick={() => toggleNodeType(node.id)}
            className={`px-3 py-1 rounded-md font-mono text-[12px] cursor-pointer
              ${node.type === 'num' 
                ? 'bg-[#3B9BFF]/20 text-[#3B9BFF]' 
                : 'bg-[#39BC66]/20 text-[#39BC66]'}`}
          >
            {node.type === 'num' ? '[num]' : '{key}'}
          </button>
          
          <input
            type="text"
            value={node.value}
            onChange={(e) => updateNodeValue(node.id, e.target.value)}
            className="flex-1 h-[32px] px-3 bg-[#1E1E1E] rounded-[6px] border-[1px] border-[#6D7177]/30 
                     text-[#CDCDCD] text-[12px] font-medium appearance-none
                     hover:border-[#6D7177]/50 transition-colors"
            placeholder={node.type === 'num' ? 'Enter number...' : 'Enter key...'}
          />

          <button
            onClick={() => deleteNode(node.id)}
            className="w-6 h-6 flex items-center justify-center rounded-lg border border-[#6D7177] hover:bg-[#252525]"
          >
            <svg width="14" height="2" viewBox="0 0 14 2">
              <path d="M0 1h14" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </button>
        </div>
        
        <div className="relative">
          {node.children.map((child) => renderNode(child, level + 1))}
          
          {level < 5 && (
            <div 
              className="flex items-center"
              style={{ marginLeft: `${level * 40 + 40}px` }}
            >
              <button
                onClick={() => addNode(node.id)}
                className="w-6 h-6 flex items-center justify-center rounded-lg border border-[#6D7177] hover:bg-[#252525] mb-2"
              >
                <svg width="14" height="14" viewBox="0 0 14 14">
                  <path d="M7 0v14M0 7h14" stroke="currentColor" strokeWidth="2"/>
                </svg>
              </button>
              <span className="ml-2 text-[12px] text-[#6D7177]">Add child</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Function to get the flattened path array
  const getFlattenedPath = () => {
    const result: (string | number)[] = [];
    
    const traverse = (node: PathNode) => {
      // Add current node value to result if it has a value
      if (node.value) {
        result.push(node.type === 'num' ? parseInt(node.value) : node.value);
      }
      
      // Traverse children
      for (const child of node.children) {
        traverse(child);
      }
    };
    
    // Start traversal from each root node
    for (const path of paths) {
      traverse(path);
    }
    
    return result;
  };

  return (
    <div className="flex flex-col gap-4 p-2 bg-[#1E1E1E] rounded-[8px] border-[1px] border-[#6D7177]/30">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[13px] font-semibold text-[#6D7177]">Path Editor</h3>
        {paths.length === 0 && (
          <button
            onClick={() => setPaths([{ id: Date.now(), type: 'key', value: '', children: [] }])}
            className="px-3 py-1 bg-[#3B9BFF]/20 text-[#3B9BFF] rounded-md text-[12px]"
          >
            Create Root Node
          </button>
        )}
      </div>
      
      {paths.map((path) => renderNode(path))}
      
      <div className="mt-2 p-2 bg-[#252525] rounded-md border border-[#6D7177]/30">
        <div className="text-[12px] text-[#6D7177] mb-1">Generated Path:</div>
        <code className="text-[12px] text-[#CDCDCD] font-mono">
          {JSON.stringify(getFlattenedPath())}
        </code>
      </div>
    </div>
  );
};

export default PathEditor; 