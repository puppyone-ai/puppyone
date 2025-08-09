'use client';
import React from 'react';
import { nanoid } from 'nanoid';

export type PathNode = {
  id: string;
  key: string; // "key" or "num"
  value: string;
  children: PathNode[];
};

interface TreePathEditorProps {
  paths: PathNode[];
  setPaths: React.Dispatch<React.SetStateAction<PathNode[]>>;
}

const TreePathEditor: React.FC<TreePathEditorProps> = ({ paths, setPaths }) => {
  const addNode = (parentId: string) => {
    setPaths(prevPaths => {
      const newPaths = JSON.parse(JSON.stringify(prevPaths));
      const findAndAddNode = (nodes: PathNode[]) => {
        for (let node of nodes) {
          if (node.id === parentId) {
            node.children.push({
              id: nanoid(6),
              key: 'key',
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

  const deleteNode = (nodeId: string) => {
    setPaths(prevPaths => {
      const newPaths = JSON.parse(JSON.stringify(prevPaths));
      const findAndDeleteNode = (nodes: PathNode[]) => {
        for (let i = 0; i < nodes.length; i++) {
          if (nodes[i].id === nodeId) {
            nodes.splice(i, 1);
            return true;
          }
          if (
            nodes[i].children.length &&
            findAndDeleteNode(nodes[i].children)
          ) {
            return true;
          }
        }
        return false;
      };
      findAndDeleteNode(newPaths);
      return newPaths;
    });
  };

  const updateNodeValue = (nodeId: string, value: string) => {
    setPaths(prevPaths => {
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

  const updateNodeKey = (nodeId: string, key: string) => {
    setPaths(prevPaths => {
      const newPaths = JSON.parse(JSON.stringify(prevPaths));
      const findAndUpdateNode = (nodes: PathNode[]) => {
        for (let node of nodes) {
          if (node.id === nodeId) {
            node.key = key;
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

  const renderNode = (node: PathNode, level = 0) => {
    const isLeafNode = node.children.length === 0;

    return (
      <div key={node.id} className='relative group'>
        <div className='relative' style={{ marginLeft: `${level * 32}px` }}>
          {/* SVG connector lines for non-root nodes */}
          {level > 0 && (
            <svg
              className='absolute -left-[16px] top-[-6px]'
              width='17'
              height='21'
              viewBox='0 0 17 21'
              fill='none'
            >
              <path
                d='M1 0L1 20H17'
                stroke='#6D7177'
                strokeWidth='1'
                strokeOpacity='0.5'
                fill='none'
              />
            </svg>
          )}

          <div className='flex items-center gap-2 mb-1.5'>
            <div className='flex-1 relative h-[32px] bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors overflow-hidden'>
              <input
                value={node.value}
                onChange={e => updateNodeValue(node.id, e.target.value)}
                className='w-full h-full bg-transparent border-none outline-none pl-[72px] pr-2
                         text-[#CDCDCD] text-[12px] appearance-none'
                placeholder={
                  node.key === 'num' ? 'Enter number...' : 'Enter key...'
                }
              />

              {/* Floating type selector */}
              <div
                className={`absolute left-[6px] top-1/2 -translate-y-1/2 h-[20px] flex items-center 
                           px-2 rounded-[4px] cursor-pointer transition-colors
                           ${
                             node.key === 'key'
                               ? 'bg-[#2D2544] border border-[#9B6DFF]/30 hover:border-[#9B6DFF]/50 hover:bg-[#2D2544]/80'
                               : 'bg-[#443425] border border-[#FF9B4D]/30 hover:border-[#FF9B4D]/50 hover:bg-[#443425]/80'
                           }`}
                onClick={() => {
                  updateNodeKey(node.id, node.key === 'key' ? 'num' : 'key');
                }}
              >
                <div
                  className={`text-[10px] font-semibold min-w-[24px] text-center
                               ${
                                 node.key === 'key'
                                   ? 'text-[#9B6DFF]'
                                   : 'text-[#FF9B4D]'
                               }`}
                >
                  {node.key}
                </div>
              </div>
            </div>

            <button
              onClick={() => deleteNode(node.id)}
              className='p-0.5 w-6 h-6 flex items-center justify-center text-[#6D7177] hover:text-[#ff4d4d] transition-colors'
            >
              <svg
                width='14'
                height='14'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
              >
                <path
                  d='M18 6L6 18M6 6l12 12'
                  strokeWidth='2'
                  strokeLinecap='round'
                />
              </svg>
            </button>
          </div>
        </div>

        <div className='relative'>
          {node.children.map(child => renderNode(child, level + 1))}

          {isLeafNode && level < 5 && (
            <div
              className='flex items-center'
              style={{ marginLeft: `${level * 32 + 32}px` }}
            >
              <button
                onClick={() => addNode(node.id)}
                className='w-6 h-6 flex items-center justify-center rounded-md
                          bg-[#252525] border-[1px] border-[#6D7177]/30
                          text-[#6D7177]
                          hover:border-[#6D7177]/50 hover:bg-[#1E1E1E] 
                          transition-colors'
              >
                <svg width='10' height='10' viewBox='0 0 14 14'>
                  <path
                    d='M7 0v14M0 7h14'
                    stroke='currentColor'
                    strokeWidth='2'
                  />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className='flex flex-col gap-3'>
      {paths.length === 0 ? (
        <button
          onClick={() =>
            setPaths([{ id: nanoid(6), key: 'key', value: '', children: [] }])
          }
          className='w-full h-[32px] flex items-center justify-center gap-2 rounded-[6px] 
                   border border-[#6D7177]/30 bg-[#252525] text-[#CDCDCD] text-[12px] font-medium 
                   hover:border-[#6D7177]/50 hover:bg-[#1E1E1E] transition-colors'
        >
          <svg
            width='12'
            height='12'
            viewBox='0 0 24 24'
            fill='none'
            stroke='#6D7177'
          >
            <path d='M12 5v14M5 12h14' strokeWidth='2' strokeLinecap='round' />
          </svg>
          Create Root Node
        </button>
      ) : (
        paths.map(path => renderNode(path))
      )}
    </div>
  );
};

export default TreePathEditor;
