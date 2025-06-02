'use client';

import React, { Fragment, useEffect, useState, useMemo } from 'react';
import { Transition } from '@headlessui/react';
import { nanoid } from 'nanoid';
import { useReactFlow } from '@xyflow/react';
import AdvancedPathEditor from '../../components/TreePathEditorMini';
import { useDataPathProcessor } from '../hooks/useDataPathProcessor';
import { useAppSettings } from '../../../states/AppSettingsContext';
import { PuppyDropdown } from '../../../misc/PuppyDropDown';

// 在文件顶部添加 PathSegment 接口定义
interface PathSegment {
    id: string;
    type: 'key' | 'num';
    value: string;
}

interface BaseIndexingItem {
    type: string;
}

interface VectorIndexingItem extends BaseIndexingItem {
    type: 'vector';
    status: 'notStarted' | 'processing' | 'done' | 'error' | 'deleting';
    key_path: PathSegment[];
    value_path: PathSegment[];
    chunks: any[];
    index_name: string;
    collection_configs: {
        set_name: string;
        model: string;
        vdb_type: string;
        user_id: string;
        collection_name: string;
    }
}

interface OtherIndexingItem extends BaseIndexingItem {
    type: 'other';
}

type IndexingItem = VectorIndexingItem | OtherIndexingItem;

interface IndexingMenuProps {
    id: string;
    showMenu: boolean;
    indexingList: IndexingItem[];
    onClose: () => void;
    onAddIndex: (newItem: IndexingItem) => void;
    onRemoveIndex: (index: number) => void;
}

const IndexingMenu: React.FC<IndexingMenuProps> = ({
    id,
    showMenu,
    indexingList = [],
    onClose,
    onAddIndex,
    onRemoveIndex
}) => {
    // 子页面状态控制
    const [showSubPage, setShowSubPage] = useState(false);
    const [indexType, setIndexType] = useState<'default' | 'vector' | 'graph'>('default');
    const [indexName, setIndexName] = useState('');

    // 新的路径状态 - 使用扁平数组
    const [keyPath, setKeyPath] = useState<PathSegment[]>([]);
    const [valuePath, setValuePath] = useState<PathSegment[]>([]);

    // 展开/收起路径编辑器的状态
    const [showKeyPathEditor, setShowKeyPathEditor] = useState(true);
    const [showValuePathEditor, setShowValuePathEditor] = useState(true);

    // 添加高级设置状态
    const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
    const [selectedEmbeddingModel, setSelectedEmbeddingModel] = useState<any>(null);

    // 使用我们的hook
    const { getNode } = useReactFlow();

    // 在组件的顶部声明为 state，初始为空数组
    const [sourceData, setSourceData] = useState<any[]>([]);

    // 添加当前选中的数据源索引状态
    const [currentSourceIndex, setCurrentSourceIndex] = useState<number>(0);

    // 使用新的数据路径处理hook
    const {
        keyResult,
        valueResult,
        generatePreviewData
    } = useDataPathProcessor(sourceData, currentSourceIndex, keyPath, valuePath);

    // 使用 AppSettingsContext 获取 embedding models
    const { availableModels } = useAppSettings();

    // 获取可用的 embedding models
    const embeddingModels = useMemo(() => {
        return availableModels.filter(model => model.active && model.type === 'embedding');
    }, [availableModels]);

    // 初始化默认 embedding model
    useEffect(() => {
        if (embeddingModels.length > 0 && !selectedEmbeddingModel) {
            setSelectedEmbeddingModel(embeddingModels[0]);
        }
    }, [embeddingModels, selectedEmbeddingModel]);

    // 从节点ID获取实际数据
    useEffect(() => {
        if (showMenu) {
            try {
                const node = getNode(id);
                if (node && node.data && node.data.content) {
                    // 解析内容为 JSON
                    let content;
                    try {
                        content = typeof node.data.content === 'string'
                            ? JSON.parse(node.data.content)
                            : node.data.content;

                        // 如果内容是数组，直接使用
                        if (Array.isArray(content)) {
                            setSourceData(content);
                        } else {
                            // 如果内容是对象，包装成数组
                            setSourceData([content]);
                        }

                        // 重置当前索引为0以确保数据加载后从第一项开始
                        setCurrentSourceIndex(0);
                    } catch (error) {
                        console.error('Error parsing JSON content:', error);
                        // 如果解析失败，将内容包装为简单对象
                        setSourceData([{ content: node.data.content }]);
                    }
                }
            } catch (error) {
                console.error('Error accessing node data:', error);
            }
        }
    }, [id, showMenu, getNode]);

    // 初始化组件时，自动生成默认路径
    useEffect(() => {
        if (showMenu && showSubPage) {
            initializeDefaultPaths();
        }
    }, [showMenu, showSubPage]);

    // 初始化默认路径
    const initializeDefaultPaths = () => {
        // 设置为空数组，而不是使用默认值
        setKeyPath([]);
        setValuePath([]);
    };

    // 处理添加索引按钮点击
    const handleAddIndexClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setShowSubPage(true);
        setIndexType('vector'); // 默认选择vector类型
        setIndexName('');

        // 调用初始化函数
        setTimeout(() => {
            initializeDefaultPaths();
        }, 100);
    };

    // 处理返回主页面
    const handleBackToMain = () => {
        setShowSubPage(false);
    };

    // 处理保存新索引
    const handleSaveNewIndex = () => {
        if (indexType === 'vector') {
            const newItem: VectorIndexingItem = {
                type: 'vector',
                status: "notStarted",
                index_name: indexName.trim() || "vector_index_" + nanoid(8),
                key_path: keyPath,
                value_path: valuePath,
                chunks: [],
                collection_configs: {
                    set_name: '',
                    model: selectedEmbeddingModel?.id || '', // 使用选择的 embedding model 的 id
                    vdb_type: '',
                    user_id: '',
                    collection_name: ''
                }
            };
            onAddIndex(newItem);
            setShowSubPage(false);
            onClose();
        } else if (indexType === 'default') {
            // 默认索引
            const newItem: OtherIndexingItem = {
                type: 'other',
            };
            onAddIndex(newItem);
            setShowSubPage(false);
            onClose();
        }
    };

    // 处理序号切换
    const handlePrevSource = () => {
        setCurrentSourceIndex(prev =>
            prev > 0 ? prev - 1 : sourceData.length - 1
        );
    };

    const handleNextSource = () => {
        setCurrentSourceIndex(prev =>
            prev < sourceData.length - 1 ? prev + 1 : 0
        );
    };

    // 添加 mapValueTodisplay 函数
    const mapModelToDisplay = (model: any) => {
        if (!model) return <span className="text-[#6D7177] text-[12px]">Select embedding model</span>;
        return <span className="text-[#CDCDCD] text-[12px] font-medium">{model.name}</span>;
    };

    // 修改 renderOption 函数，使用与 LLM 组件相同的样式
    const renderModelOption = (modelObj: any) => {
        return (
            <div className="flex items-center justify-between w-full">
                <span className="truncate mr-2">{modelObj.name || modelObj.id}</span>
                {modelObj.isLocal ? (
                    <span className="ml-auto px-1.5 py-0.5 text-[10px] rounded bg-[#2A4365] text-[#90CDF4] flex-shrink-0">
                        Local
                    </span>
                ) : (
                    <span className="ml-auto px-1.5 py-0.5 text-[10px] rounded bg-[#4A4A4A] text-[#CDCDCD] flex-shrink-0">
                        Cloud
                    </span>
                )}
            </div>
        );
    };

    return (
        <Transition
            show={showMenu}
            as={Fragment}
            enter="transition ease-out duration-200"
            enterFrom="transform opacity-0 translate-y-[-10px]"
            enterTo="transform opacity-100 translate-y-0"
            leave="transition ease-in duration-150"
            leaveFrom="transform opacity-100 translate-y-0"
            leaveTo="transform opacity-0 translate-y-[-10px]"
        >
            <div className={`absolute top-[8px] ${!showSubPage ? ' w-[360px]' : ' w-[420px]'} p-[8px] bg-[#252525] border-[1px] border-[#404040] rounded-[8px] shadow-lg shadow-black/20 z-[20000] flex flex-col gap-3`}>
                {/* 主页面 */}
                {!showSubPage ? (
                    <>
                        <div className='flex items-center justify-between h-[32px] pl-[8px]  border-b border-[#6D7177]/30'>
                            <span className='text-[12px] font-medium text-[#9B9B9B]'>Index Management</span>
                            <button
                                onClick={onClose}
                                className='p-0.5 w-6 h-6 flex items-center justify-center text-[#6D7177] hover:text-[#CDCDCD] rounded-full hover:bg-[#3A3A3A] transition-colors'
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                    <path d="M18 6L6 18M6 6l12 12" strokeWidth="2" strokeLinecap="round" />
                                </svg>
                            </button>
                        </div>

                        <div className='flex flex-col gap-3'>
                            {indexingList.length === 0 ? (
                                <div className="flex flex-col items-center gap-3 py-6 px-3">

                                    <p className="text-[12px] text-[#9B9B9B] text-center mb-[4px]">Add an index to organize and retrieve content</p>
                                    <button
                                        onClick={handleAddIndexClick}
                                        className='w-full h-[36px] flex items-center justify-center gap-2 rounded-[6px] 
                                        bg-[#39BC66] hover:bg-[#45D277] text-white text-[13px] font-medium 
                                        transition-colors'
                                    >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                            <path d="M12 5v14M5 12h14" strokeWidth="2" strokeLinecap="round" />
                                        </svg>
                                        Add New Index
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <div className="mb-1 flex justify-between items-center">
                                        <span className="text-[12px] text-[#9B9B9B]">
                                            {indexingList.length} {indexingList.length === 1 ? 'index' : 'indices'}
                                        </span>
                                        <button
                                            onClick={handleAddIndexClick}
                                            className='px-2 h-[28px] flex items-center gap-1.5 rounded-[6px] 
                                                bg-[#39BC66] hover:bg-[#45D277] text-white text-[12px] 
                                                 transition-colors'
                                        >
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                <path d="M12 5v14M5 12h14" strokeWidth="2" strokeLinecap="round" />
                                            </svg>
                                            Add Index
                                        </button>
                                    </div>

                                    <div className="overflow-auto max-h-[420px] pr-1 -mr-1">
                                        {indexingList.map((item, index) => (
                                            <div key={index} className="relative group mb-3 last:mb-0 bg-[#1E1E1E] rounded-[6px] overflow-hidden hover:bg-[#1E1E1E]/90 transition-colors">
                                                <div className="flex items-center gap-2 p-2">
                                                    {/* 左侧状态指示条，根据状态改变颜色 */}
                                                    <div className={`w-[4px] h-[calc(100%-12px)] absolute left-2 top-[6px] rounded-sm 
                                                        ${ (item as VectorIndexingItem).status === 'error' 
                                                            ? 'bg-[#E53935]' 
                                                            : (item as VectorIndexingItem).status === 'processing' 
                                                                ? 'bg-[#FFC107]' 
                                                                : (item as VectorIndexingItem).status === 'deleting'
                                                                    ? 'bg-[#FF9800]'
                                                                    : (item as VectorIndexingItem).status === 'done'
                                                                        ? 'bg-[#39BC66]'
                                                                        : 'bg-[#39BC66]'}`}>
                                                    </div>

                                                    <div className='flex-1 pl-4'>
                                                        <div className="flex items-center">
                                                            <div className={`text-[10px] font-medium max-w-[140px] truncate
                                                                ${item.type === 'vector' && (item as VectorIndexingItem).status === 'error' 
                                                                    ? 'text-[#E53935]' 
                                                                    : item.type === 'vector' && (item as VectorIndexingItem).status === 'processing' 
                                                                        ? 'text-[#FFC107]' 
                                                                        : 'text-[#39BC66]'}`}>
                                                                {(item as VectorIndexingItem).index_name}
                                                            </div>
                                                            
                                                            {/* 状态指示器标签 - 使用图标+文字的组合呈现 */}
                                                            {(item as VectorIndexingItem).status !== 'notStarted' && (
                                                                <div className={`ml-2 flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium
                                                                    ${(item as VectorIndexingItem).status === 'processing' 
                                                                        ? 'bg-[#FFC107]/10 text-[#FFC107]' 
                                                                        : (item as VectorIndexingItem).status === 'deleting'
                                                                            ? 'bg-[#FF9800]/10 text-[#FF9800]'
                                                                            : (item as VectorIndexingItem).status === 'error'
                                                                                ? 'bg-[#E53935]/10 text-[#E53935]'
                                                                                : 'bg-[#39BC66]/10 text-[#39BC66]'
                                                                    }`}>
                                                                    {/* 状态图标 */}
                                                                    {(item as VectorIndexingItem).status === 'processing' && (
                                                                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="animate-spin" style={{animationDuration: '1.5s'}}>
                                                                            <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" 
                                                                                strokeWidth="3" 
                                                                                strokeLinecap="round" />
                                                                        </svg>
                                                                    )}
                                                                    {(item as VectorIndexingItem).status === 'deleting' && (
                                                                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="animate-spin" style={{animationDuration: '1.5s'}}>
                                                                            <path d="M18 6L6 18M6 6l12 12" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                                                                        </svg>
                                                                    )}
                                                                    {(item as VectorIndexingItem).status === 'error' && (
                                                                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                                            <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeWidth="2" strokeLinecap="round" />
                                                                        </svg>
                                                                    )}
                                                                    {(item as VectorIndexingItem).status === 'done' && (
                                                                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                                            <path d="M5 13l4 4L19 7" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                                                                        </svg>
                                                                    )}
                                                                    
                                                                    {/* 状态文本 */}
                                                                    <span>
                                                                        {(item as VectorIndexingItem).status === 'processing' && 'Processing'}
                                                                        {(item as VectorIndexingItem).status === 'deleting' && 'Deleting'}
                                                                        {(item as VectorIndexingItem).status === 'error' && 'Error'}
                                                                        {(item as VectorIndexingItem).status === 'done' && 'Complete'}
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                        
                                                        
                                                    </div>

                                                    <div className="flex items-center">
                                                        {/* 类型标签 - 使用更简洁、不那么突兀的设计 */}
                                                        <div className={`h-[18px] flex items-center px-2 rounded-[4px] mr-2
                                                            bg-[#1A1A1A] border border-[#505050]/30`}>
                                                            <div className="text-[9px] font-medium text-[#CDCDCD]">
                                                                {item.type}
                                                            </div>
                                                        </div>

                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onRemoveIndex(index);
                                                            }}
                                                            className='p-0.5 w-6 h-6 flex items-center justify-center text-[#6D7177] hover:text-[#ff4d4d] transition-colors rounded-full hover:bg-[#252525]'
                                                        >
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                                <path d="M18 6L6 18M6 6l12 12" strokeWidth="2" strokeLinecap="round" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    </>
                ) : (
                    /* 子页面：添加新索引 */
                    <>
                        <div className='flex w-full items-center justify-between h-[32px] border-b border-[#6D7177]/30'>
                            <button
                                onClick={handleBackToMain}
                                className='flex items-center text-[#CDCDCD] hover:text-white'
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                                <span className='text-[12px] font-medium ml-1'>Back</span>
                            </button>
                        </div>

                        <div className='flex flex-col gap-4'>


                            {/* 预览区域 */}
                            <div className='flex flex-col gap-2 mt-1'>
                                <div className="flex items-center justify-between">
                                    <label className='text-[12px] text-[#9B9B9B] flex items-center gap-1'>
                                        <div className="flex items-center">
                                            <span>Data Preview</span>

                                        </div>
                                    </label>

                                    <div className='flex items-center gap-1'>
                                        <button
                                            onClick={handlePrevSource}
                                            className='text-[10px] h-[22px] w-[22px] rounded flex items-center justify-center bg-[#252525] text-[#CDCDCD] border border-[#6D7177]/30 hover:border-[#6D7177]/50 hover:bg-[#1E1E1E]'
                                        >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                <path d="M15 18l-6-6 6-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                        </button>
                                        <div className='text-[10px] font-medium text-[#CDCDCD] px-1.5'>
                                            {currentSourceIndex + 1} / {sourceData.length}
                                        </div>
                                        <button
                                            onClick={handleNextSource}
                                            className='text-[10px] h-[22px] w-[22px] rounded flex items-center justify-center bg-[#252525] text-[#CDCDCD] border border-[#6D7177]/30 hover:border-[#6D7177]/50 hover:bg-[#1E1E1E]'
                                        >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                <path d="M9 6l6 6-6 6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>

                                {/* 显示当前元素 */}
                                <div className='bg-[#1A1A1A] rounded-[6px] border border-[#404040]/50 overflow-hidden'>
                                    {/* 源数据 */}
                                    <div className='p-2'>
                                        <div className='bg-[#1E1E1E] rounded-[6px] border border-[#404040]/30 overflow-hidden flex flex-col h-[160px] mb-3'>
                                            <div className='px-2 py-1 bg-[#1E1E1E] border-b border-[#404040]/30 flex items-center justify-between'>
                                                <div className='text-[11px] font-medium text-[#CDCDCD]'>
                                                    Chunk Raw Data: <span className="text-[#9B7EDB] font-semibold"> # {currentSourceIndex + 1}</span>
                                                </div>
                                            </div>
                                            <div className='p-2 flex-1 overflow-auto'>
                                                <div className='text-[10px] text-[#9B9B9B] font-mono h-full'>
                                                    <pre>{JSON.stringify(sourceData[currentSourceIndex], null, 2)}</pre>
                                                </div>
                                            </div>
                                        </div>

                                        <div className='flex flex-row gap-2'>
                                            {/* 左侧: 键详情 */}
                                            <div className='w-1/2 flex flex-col gap-2'>
                                                <div className='bg-[#1E1E1E] rounded-[6px] border border-[#404040]/30 overflow-hidden'>
                                                    <div
                                                        className='px-2 py-1 bg-[#2A2A2A] hover:bg-[#303030] border-b border-[#404040]/30 flex items-center justify-between cursor-pointer relative transition-colors'
                                                        onClick={() => setShowKeyPathEditor(!showKeyPathEditor)}
                                                    >
                                                        <div className='w-1 h-[12px] absolute left-[4px] top-1/2 transform -translate-y-1/2 rounded-sm bg-[#39BC66]'></div>
                                                        <div className='text-[11px] font-medium text-[#CDCDCD] ml-3'>Key Path</div>
                                                        <div className='text-[#9B9B9B]'>
                                                            {showKeyPathEditor ? (
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                                    <path d="M18 15l-6-6-6 6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                                </svg>
                                                            ) : (
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                                    <path d="M6 9l6 6 6-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                                </svg>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className={`transition-all overflow-hidden ${showKeyPathEditor ? 'max-h-[400px]' : 'max-h-0'}`}>
                                                        <div className='p-2'>
                                                            <AdvancedPathEditor
                                                                path={keyPath}
                                                                onChange={setKeyPath}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className='bg-[#1E1E1E] rounded-[6px] border border-[#404040]/30 overflow-hidden flex flex-col h-[128px]'>
                                                    <div className='px-2 py-1 bg-[#1E1E1E] border-b border-[#404040]/30 flex items-center'>
                                                        <div className='text-[11px] font-medium text-[#CDCDCD]'>Indexed Content</div>
                                                    </div>
                                                    <div className='p-2 flex-1 overflow-auto'>
                                                        <div className='text-[10px] text-[#9B9B9B] font-mono h-full'>
                                                            {typeof keyResult === 'object'
                                                                ? <pre>{JSON.stringify(keyResult, null, 2)}</pre>
                                                                : String(keyResult)
                                                            }
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* 右侧: 检索内容 */}
                                            <div className='w-1/2 flex flex-col gap-2'>
                                                <div className='bg-[#1E1E1E] rounded-[6px] border border-[#404040]/30 overflow-hidden'>
                                                    <div
                                                        className='px-2 py-1 bg-[#2A2A2A] hover:bg-[#303030] border-b border-[#404040]/30 flex items-center justify-between cursor-pointer relative transition-colors'
                                                        onClick={() => setShowValuePathEditor(!showValuePathEditor)}
                                                    >
                                                        <div className='w-1 h-[12px] absolute left-[4px] top-1/2 transform -translate-y-1/2 rounded-sm bg-[#39BC66]'></div>
                                                        <div className='text-[11px] font-medium text-[#CDCDCD] ml-3'>Value Path</div>
                                                        <div className='text-[#9B9B9B]'>
                                                            {showValuePathEditor ? (
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                                    <path d="M18 15l-6-6-6 6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                                </svg>
                                                            ) : (
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                                    <path d="M6 9l6 6 6-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                                </svg>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className={`transition-all overflow-hidden ${showValuePathEditor ? 'max-h-[400px]' : 'max-h-0'}`}>
                                                        <div className='p-2'>
                                                            <AdvancedPathEditor
                                                                path={valuePath}
                                                                onChange={setValuePath}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className='bg-[#1E1E1E] rounded-[6px] border border-[#404040]/30 overflow-hidden flex flex-col h-[128px]'>
                                                    <div className='px-2 py-1 bg-[#1E1E1E] border-b border-[#404040]/30 flex items-center'>
                                                        <div className='text-[11px] font-medium text-[#CDCDCD]'>Return Value</div>
                                                    </div>
                                                    <div className='p-2 flex-1 overflow-auto text-[10px] font-mono text-[#9B9B9B]'>
                                                        {typeof valueResult === 'object'
                                                            ? <pre>{JSON.stringify(valueResult, null, 2)}</pre>
                                                            : String(valueResult)
                                                        }
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* 高级设置 */}
                            <div className='flex flex-col gap-2'>
                                <div className='flex items-center justify-between'>
                                    <div className='flex items-center gap-2'>
                                        <label className='text-[13px] font-semibold text-[#6D7177]'>Advanced Settings</label>
                                        <div className='w-[5px] h-[5px] rounded-full bg-[#6D7177]'></div>
                                    </div>
                                    <button
                                        onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                                        className='text-[12px] text-[#6D7177] hover:text-[#39BC66] transition-colors flex items-center gap-1'
                                    >
                                        {showAdvancedSettings ? 'Hide' : 'Show'}
                                        <svg
                                            className={`w-4 h-4 transition-transform ${showAdvancedSettings ? 'rotate-180' : ''}`}
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                        >
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </button>
                                </div>

                                {showAdvancedSettings && (
                                    <div className='flex flex-col gap-2 p-2 bg-[#1E1E1E] rounded-[8px] border-[1px] border-[#6D7177]/30'>
                                        <div className='flex flex-col gap-2'>
                                            <div className='flex flex-col gap-1'>
                                                <label className='text-[12px] font-medium text-[#6D7177]'>Embedding Model</label>
                                                <div className='relative h-[32px] bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                                                    <PuppyDropdown
                                                        options={embeddingModels}
                                                        selectedValue={selectedEmbeddingModel}
                                                        onSelect={(selectedModel: any) => setSelectedEmbeddingModel(selectedModel)}
                                                        buttonHeight="32px"
                                                        buttonBgColor="transparent"
                                                        menuBgColor="#1A1A1A"
                                                        listWidth="100%"
                                                        containerClassnames="w-full"
                                                        mapValueTodisplay={mapModelToDisplay}
                                                        renderOption={renderModelOption}
                                                    />
                                                </div>
                                                {/* 显示当前选择的模型详细信息 */}
                                                {selectedEmbeddingModel && (
                                                    <div className='text-[10px] text-[#6D7177] flex items-center gap-2 mt-1'>
                                                        <span>Provider: {selectedEmbeddingModel.provider}</span>
                                                        <span>•</span>
                                                        <span>{selectedEmbeddingModel.isLocal ? 'Local' : 'Cloud'}</span>
                                                        <span>•</span>
                                                        <span>ID: {selectedEmbeddingModel.id}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* 保存按钮 */}
                            <button
                                onClick={handleSaveNewIndex}
                                className='w-full h-[36px] flex items-center justify-center gap-2 rounded-[6px] 
                                text-white text-[13px] font-medium transition-colors mt-2
                                bg-[#39BC66] hover:bg-[#45D277]'
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                    <path d="M5 13l4 4L19 7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                                Create Index
                            </button>
                        </div>
                    </>
                )}

            </div>
        </Transition>
    );
};

export default IndexingMenu;
