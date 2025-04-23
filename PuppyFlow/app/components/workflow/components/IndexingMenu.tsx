'use client';

import React, { Fragment, useEffect, useState } from 'react';
import { Transition } from '@headlessui/react';
import { nanoid } from 'nanoid';
import { useReactFlow } from '@xyflow/react';
import AdvancedPathEditor from './TreePathEditorMini';
import { useDataPathProcessor } from './../blockNode/hooks/useDataPathProcessor';

// 不要从./types导入，而是在组件内部定义所需的接口
interface BaseIndexingItem {
    type: string;
    content: string;
}

interface VectorIndexingItem extends BaseIndexingItem {
    type: 'vector';
    path: string[];
    index_name: string;
}

type IndexingItem = VectorIndexingItem | { type: string, content: string };

// 预览数据的接口
interface PreviewChunk {
    key: string;
    value: string;
}

// 在文件顶部添加 PathSegment 接口定义
interface PathSegment {
    id: string;
    type: 'key' | 'num';
    value: string;
}

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
    const [showKeyPathEditor, setShowKeyPathEditor] = useState(false);
    const [showValuePathEditor, setShowValuePathEditor] = useState(false);

    // 预览状态 - 设置初始预览数据为空
    const [showPreview, setShowPreview] = useState(true); // 默认显示预览

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
            if (indexName.trim()) {
                // 将 PathSegment 转换为字符串
                const pathString = keyPath.map(segment => segment.value).join('.');
                if (pathString) {
                    const newItem: VectorIndexingItem = {
                        type: 'vector',
                        content: '',
                        index_name: indexName,
                        path: [pathString]
                    };
                    onAddIndex(newItem);
                    setShowSubPage(false);
                    onClose();
                }
            } else {
                // 如果未设置索引名称，使用默认名称
                const pathString = keyPath.map(segment => segment.value).join('.');
                if (pathString) {
                    const newItem: VectorIndexingItem = {
                        type: 'vector',
                        content: '',
                        index_name: "vector_index_" + Math.floor(Math.random() * 1000),
                        path: [pathString]
                    };
                    onAddIndex(newItem);
                    setShowSubPage(false);
                    onClose();
                }
            }
        } else if (indexType === 'default') {
            // 默认索引只需要基本信息
            const newItem: BaseIndexingItem = {
                type: 'default',
                content: indexName || '默认索引'
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
            <div className={`absolute top-[40px] ${!showSubPage ? 'right-[-350px] w-[320px]' : 'right-[-540px] w-[420px]'} p-[12px] bg-[#252525] border-[1px] border-[#404040] rounded-[8px] shadow-lg shadow-black/20 z-[20000] flex flex-col gap-3`}>
                {/* 主页面 */}
                {!showSubPage ? (
                    <>
                        <div className='flex items-center justify-between pb-2 border-b border-[#6D7177]/30'>
                            <span className='text-[13px] font-medium text-[#CDCDCD]'>Index Management</span>
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
                                    <div className="w-12 h-12 rounded-full bg-[#2D4425] flex items-center justify-center mb-1">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#39BC66">
                                            <path d="M19 9l-7 7-7-7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    </div>
                                    <p className="text-[13px] text-[#9B9B9B] text-center mb-2">Add an index to organize and retrieve content more efficiently</p>
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
                                                font-medium transition-colors'
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
                                                    <div className={`w-1.5 h-[calc(100%-12px)] absolute left-2 top-[6px] rounded-sm ${item.type === 'vector' ? 'bg-[#39BC66]' : 'bg-[#FF9B4D]'}`}></div>

                                                    <div className='flex-1 pl-4'>
                                                        <div className={`text-[12px] font-medium mb-1
                                                            ${item.type === 'vector' ? 'text-[#39BC66]' : 'text-[#FF9B4D]'}`}>
                                                            {item.type === 'vector' ? (item as VectorIndexingItem).index_name : 'Default Index'}
                                                        </div>
                                                        <div className='text-[11px] text-[#9B9B9B] truncate'>
                                                            {item.type === 'vector' ? (item as VectorIndexingItem).path.join('.') : item.content}
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center">
                                                        <div
                                                            className={`h-[20px] flex items-center px-2 rounded-[4px] mr-2
                                                                ${item.type === 'vector'
                                                                    ? 'bg-[#2D4425] border border-[#39BC66]/30'
                                                                    : 'bg-[#443425] border border-[#FF9B4D]/30'}`}
                                                        >
                                                            <div className={`text-[10px] font-semibold
                                                                ${item.type === 'vector'
                                                                    ? 'text-[#39BC66]'
                                                                    : 'text-[#FF9B4D]'}`}>
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
                        <div className='flex w-full items-center justify-between pb-2 border-b border-[#6D7177]/30'>
                            <button
                                onClick={handleBackToMain}
                                className='flex items-center text-[#CDCDCD] hover:text-white'
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                                <span className='text-[13px] font-medium ml-1'>Back</span>
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
                                                <div className='text-[11px] font-medium text-[#CDCDCD]'>Source Data</div>
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
                                                            <button
                                                                onClick={() => generatePreviewData()}
                                                                className="text-[10px] mt-2 px-2 py-1 rounded-[4px] flex items-center gap-1 bg-[#39BC66] text-white border border-[#39BC66]/30 hover:bg-[#45D277] ml-auto"
                                                            >
                                                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                                    <path d="M5 3l14 9-14 9V3z" strokeWidth="2" />
                                                                </svg>
                                                                Apply
                                                            </button>
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
                                                            <button
                                                                onClick={() => generatePreviewData()}
                                                                className="text-[10px] mt-2 px-2 py-1 rounded-[4px] flex items-center gap-1 bg-[#39BC66] text-white border border-[#39BC66]/30 hover:bg-[#45D277] ml-auto"
                                                            >
                                                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                                    <path d="M5 3l14 9-14 9V3z" strokeWidth="2" />
                                                                </svg>
                                                                Apply
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className='bg-[#1E1E1E] rounded-[6px] border border-[#404040]/30 overflow-hidden flex flex-col h-[128px]'>
                                                    <div className='px-2 py-1 bg-[#1E1E1E] border-b border-[#404040]/30 flex items-center'>
                                                        <div className='text-[11px] font-medium text-[#CDCDCD]'>Return Value</div>
                                                    </div>
                                                    <div className='p-2 flex-1 overflow-auto text-[10px] text-[#9B9B9B]'>
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

                            {/* 保存按钮 */}
                            <button
                                onClick={handleSaveNewIndex}
                                className={`w-full h-[36px] flex items-center justify-center gap-2 rounded-[6px] 
                                text-white text-[13px] font-medium transition-colors mt-2
                                ${keyPath.length > 0
                                        ? 'bg-[#39BC66] hover:bg-[#45D277]'
                                        : 'bg-[#39BC66]/50 cursor-not-allowed'}`}
                                disabled={keyPath.length === 0}
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
