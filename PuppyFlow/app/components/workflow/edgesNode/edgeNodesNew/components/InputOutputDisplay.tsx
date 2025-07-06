import React, { useState,useEffect} from 'react';
import { Node } from '@xyflow/react';

type NodeType = 'text' | 'file' | 'structured';
type NodeCategory = 'blocknode' | 'edgenode' | 'servernode' | 'groupnode' | 'all';

interface InputOutputDisplayProps {
    parentId: string;
    getNode: (id: string) => Node | undefined;
    getSourceNodeIdWithLabel: (id: string, category?: NodeCategory) => Array<{ id: string, label: string }>;
    getTargetNodeIdWithLabel: (id: string, category?: NodeCategory) => Array<{ id: string, label: string }>;
    supportedInputTypes?: NodeType[];
    supportedOutputTypes?: NodeType[];
    inputNodeCategory?: NodeCategory;
    outputNodeCategory?: NodeCategory;
    onUpdate?: () => void; 
}

export const InputOutputDisplay: React.FC<InputOutputDisplayProps> = ({
    parentId,
    getNode,
    getSourceNodeIdWithLabel,
    getTargetNodeIdWithLabel,
    supportedInputTypes = ['text', 'file', 'structured'],
    supportedOutputTypes = ['text', 'file', 'structured'],
    inputNodeCategory = 'blocknode',
    outputNodeCategory = 'blocknode',
    onUpdate
}) => {
    useEffect(() => {
        onUpdate?.();
      });
    const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(`{{${text}}}`).then(() => {
            setCopiedLabel(text);
            setTimeout(() => setCopiedLabel(null), 1000);
        }).catch(err => {
            console.warn('Failed to copy:', err);
        });
    };

    const NodeLabel = ({ node, nodeType }: { node: { id: string, label: string }, nodeType: string }) => {
        const colorClasses = {
            text: {
                active: 'bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#39BC66]',
                default: 'bg-[#252525] border-[#3B9BFF]/50 text-[#3B9BFF] hover:border-[#3B9BFF]/80 hover:bg-[#3B9BFF]/5'
            },
            file: {
                active: 'bg-[#9E7E5F]/20 border-[#9E7E5F] text-[#39BC66]',
                default: 'bg-[#252525] border-[#9E7E5F]/50 text-[#9E7E5F] hover:border-[#9E7E5F]/80 hover:bg-[#9E7E5F]/5'
            },
            structured: {
                active: 'bg-[#9B7EDB]/20 border-[#9B7EDB] text-[#39BC66]',
                default: 'bg-[#252525] border-[#9B7EDB]/50 text-[#9B7EDB] hover:border-[#9B7EDB]/80 hover:bg-[#B0A4E3]/5'
            }
        };

        const nodeIcons = {
            text: (
                <svg width="12" height="12" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
                    <path d="M3 8H17" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M3 12H15" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M3 16H13" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
            ),
            file: (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
                    <path d="M4 6H10L12 8H20V18H4V6Z" className="fill-transparent stroke-current" strokeWidth="1.5" />
                    <path d="M8 13.5H16" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
            ),
            structured: (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
                    <path d="M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z" className="fill-current" />
                    <path d="M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z" className="fill-current" />
                    <path d="M9 9H11V11H9V9Z" className="fill-current" />
                    <path d="M9 13H11V15H9V13Z" className="fill-current" />
                    <path d="M13 9H15V11H13V9Z" className="fill-current" />
                    <path d="M13 13H15V15H13V13Z" className="fill-current" />
                </svg>
            )
        };

        const colors = colorClasses[nodeType as keyof typeof colorClasses] || colorClasses.text;
        const icon = nodeIcons[nodeType as keyof typeof nodeIcons] || nodeIcons.text;

        return (
            <button
                key={`${node.id}-${parentId}`}
                onClick={() => copyToClipboard(node.label)}
                className={`flex items-center gap-[4px] px-[8px] h-[20px] rounded-[4px] 
                         border-[1px] text-[10px] font-medium transition-all duration-200
                         ${copiedLabel === node.label ? colors.active : colors.default}`}
            >
                <div className="flex-shrink-0">{icon}</div>
                <span className="truncate max-w-[100px]">
                    {copiedLabel === node.label ? 'Copied!' : `{{${node.label}}}`}
                </span>
            </button>
        );
    };

    // 根据支持的类型过滤图标
    const renderTypeIcons = (types: NodeType[]) => {
        return (
            <div className='flex items-center gap-[6px]'>
                {types.includes('text') && (
                    <svg width="12" height="12" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M3 8H17" className="stroke-[#3B9BFF]" strokeWidth="1.5" strokeLinecap="round" />
                        <path d="M3 12H15" className="stroke-[#3B9BFF]" strokeWidth="1.5" strokeLinecap="round" />
                        <path d="M3 16H13" className="stroke-[#3B9BFF]" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                )}
                {types.includes('structured') && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z" className="fill-[#9B7EDB]" />
                        <path d="M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z" className="fill-[#9B7EDB]" />
                        <path d="M9 9H11V11H9V9Z" className="fill-[#9B7EDB]" />
                        <path d="M9 13H11V15H9V13Z" className="fill-[#9B7EDB]" />
                        <path d="M13 9H15V11H13V9Z" className="fill-[#9B7EDB]" />
                        <path d="M13 13H15V15H13V13Z" className="fill-[#9B7EDB]" />
                    </svg>
                )}
                {types.includes('file') && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M4 6H10L12 8H20V18H4V6Z" className="fill-transparent stroke-[#9E7E5F]" strokeWidth="1.5" />
                        <path d="M8 13.5H16" className="stroke-[#9E7E5F]" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                )}
            </div>
        );
    };

    // 使用节点类别过滤获取源节点和目标节点
    const sourceNodes = getSourceNodeIdWithLabel(parentId, inputNodeCategory);
    const targetNodes = getTargetNodeIdWithLabel(parentId, outputNodeCategory);

    return (
        <div className='flex flex-row gap-[12px]'>
            {/* Input section */}
            <div className='flex-1 flex flex-col gap-1'>
                <div className='flex items-center gap-2'>
                    <label className='text-[11px] font-regular text-[#6D7177] ml-1'>Input</label>
                    {renderTypeIcons(supportedInputTypes)}
                </div>
                <div className='p-[8px] bg-transparent rounded-[8px] border-[1px] border-dashed border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors min-h-[36px]'>
                    <div className='flex flex-wrap gap-2'>
                        {sourceNodes.map(node => (
                            <NodeLabel 
                                key={node.id} 
                                node={node} 
                                nodeType={getNode(node.id)?.type || 'text'} 
                            />
                        ))}
                    </div>
                </div>
            </div>

            {/* Output section */}
            <div className='flex-1 flex flex-col gap-1'>
                <div className='flex items-center gap-2'>
                    <label className='text-[11px] font-regular text-[#6D7177] ml-1'>Output</label>
                    {renderTypeIcons(supportedOutputTypes)}
                </div>
                <div className='p-[8px] bg-transparent rounded-[8px] border-[1px] border-dashed border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors min-h-[36px]'>
                    <div className='flex flex-wrap gap-2'>
                        {targetNodes.map(node => (
                            <NodeLabel 
                                key={node.id} 
                                node={node} 
                                nodeType={getNode(node.id)?.type || 'text'} 
                            />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default InputOutputDisplay;
