'use client'
import React, { useState } from 'react';
import ComponentRenderer, { createEmptyElement, useHover, useSelection } from './ComponentRenderer';
import DictActionMenu from './DictActionMenu';
import { getClipboard } from './ClipboardStore';
import { useOverflowContext } from './OverflowContext';

type DictComponentProps = {
    data: Record<string, any>;
    path: string;
    readonly?: boolean;
    isNested?: boolean;
    onUpdate: (newData: Record<string, any>) => void;
    onDelete?: () => void;
    parentKey?: string | number;
    preventParentDrag: () => void;
    allowParentDrag: () => void;
    onReplace?: (newValue: any) => void;
}

const DictComponent = ({ 
    data, 
    path = '',
    readonly = false, 
    isNested = false, 
    onUpdate, 
    onDelete,
    parentKey,
    preventParentDrag, 
    allowParentDrag,
    onReplace,
}: DictComponentProps) => {
    const [dragOverKey, setDragOverKey] = useState<string | null>(null); // unused after removing DnD
    const [dragOverPosition, setDragOverPosition] = useState<'before' | 'after' | null>(null); // unused after removing DnD
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [showMenu, setShowMenu] = useState(false);
    
    const { hoveredPath, setHoveredPath, isPathHovered } = useHover();

    const keys = Object.keys(data);

    const deleteKey = (keyToDelete: string) => {
        const newData = { ...data };
        delete newData[keyToDelete];
        onUpdate(newData);
    };

    // 生成随机key的函数
    const generateRandomKey = () => {
        const existingKeys = Object.keys(data);
        let newKey = `key_${Math.random().toString(36).substr(2, 6)}`;
        
        // 确保key不重复
        while (existingKeys.includes(newKey)) {
            newKey = `key_${Math.random().toString(36).substr(2, 6)}`;
        }
        
        return newKey;
    };

    const addEmptyKey = () => {
        const newKey = generateRandomKey();
        const newData = {
            ...data,
            [newKey]: createEmptyElement()
        };
        onUpdate(newData);
    };

    const updateValue = (key: string, newValue: any) => {
        const newData = {
            ...data,
            [key]: newValue
        };
        onUpdate(newData);
    };

    // Inline key actions state
    const [actionKey, setActionKey] = useState<string | null>(null);
    const [renamingKey, setRenamingKey] = useState<string | null>(null);
    const [renameInput, setRenameInput] = useState<string>('');

    const beginRenameKey = (key: string) => {
        setRenamingKey(key);
        setRenameInput(key);
    };

    const ensureUniqueKey = (base: string, excludeKey?: string) => {
        let candidate = base;
        let n = 1;
        const existing = new Set(Object.keys(data).filter(k => k !== excludeKey));
        while (existing.has(candidate)) candidate = `${base}_${n++}`;
        return candidate;
    };

    const submitRenameKey = (oldKey: string) => {
        const raw = renameInput.trim();
        setRenamingKey(null);
        setActionKey(null);
        if (!raw || raw === oldKey) return;
        if (/[\.\[\]]/.test(raw)) return;
        const newKey = ensureUniqueKey(raw, oldKey);
        if (newKey === oldKey) return;
        const { [oldKey]: movedValue, ...rest } = data;
        onUpdate({ ...rest, [newKey]: movedValue });
    };

    React.useEffect(() => {
        const onDoc = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest('.rjft-key-inline-actions')) return;
            setActionKey(null);
        };
        document.addEventListener('mousedown', onDoc, true);
        return () => document.removeEventListener('mousedown', onDoc, true);
    }, []);


    // 创建拖拽预览元素
    const createDragPreview = (key: string, value: any) => {
        const preview = document.createElement('div');
        preview.style.cssText = `
            position: absolute;
            top: -1000px;
            left: -1000px;
            background: #1a1a1a;
            border: 1px solid #444;
            border-radius: 8px;
            padding: 8px 12px;
            font-family: 'Plus Jakarta Sans', sans-serif;
            font-size: 12px;
            color: #CDCDCD;
            max-width: 200px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 1000;
            pointer-events: none;
        `;
        
        // 创建key部分
        const keySpan = document.createElement('span');
        keySpan.style.cssText = `
            color: #9b7edb;
            font-style: italic;
            margin-right: 8px;
        `;
        keySpan.textContent = key;
        
        // 创建分隔符
        const separator = document.createElement('span');
        separator.style.cssText = `
            color: #6D7177;
            margin-right: 8px;
        `;
        separator.textContent = ':';
        
        // 创建值预览部分
        const valueSpan = document.createElement('span');
        valueSpan.style.cssText = `
            color: #CDCDCD;
            opacity: 0.8;
        `;
        
        // 根据值类型显示不同的预览
        let valuePreview = '';
        if (typeof value === 'string') {
            valuePreview = value.length > 20 ? `"${value.substring(0, 20)}..."` : `"${value}"`;
        } else if (Array.isArray(value)) {
            valuePreview = `[${value.length} items]`;
        } else if (typeof value === 'object' && value !== null) {
            const keys = Object.keys(value);
            valuePreview = `{${keys.length} keys}`;
        } else {
            valuePreview = String(value);
        }
        
        valueSpan.textContent = valuePreview;
        
        preview.appendChild(keySpan);
        preview.appendChild(separator);
        preview.appendChild(valueSpan);
        
        return preview;
    };

    // Drag-and-drop disabled: remove handlers


    // Drag-and-drop disabled

    // 构建当前key的完整路径
    const getKeyPath = (key: string) => {
        return path ? `${path}.${key}` : key;
    };

    // 处理hover事件
    const handleKeyHover = (key: string, isEntering: boolean) => {
        if (isEntering) {
            setHoveredPath(getKeyPath(key));
        } else {
            setHoveredPath(null);
        }
    };

    const handleMenuClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setShowMenu(!showMenu);
    };

    const handleCopyObject = () => {
        navigator.clipboard.writeText(JSON.stringify(data, null, 2));
        setShowMenu(false);
    };

    const handleClearObject = () => {
        onUpdate(null as any);
        setShowMenu(false);
    };

    const handleDeleteObject = () => {
        if (onDelete) {
            onDelete();
        }
        setShowMenu(false);
    };

    const handleClearAll = () => {
        onUpdate({});
        setShowMenu(false);
    };

    React.useEffect(() => {
        const handleClickOutside = () => setShowMenu(false);
        if (showMenu) {
            document.addEventListener('click', handleClickOutside);
            return () => document.removeEventListener('click', handleClickOutside);
        }
    }, [showMenu]);

    const handleMenuMouseLeave = () => {
        setShowMenu(false);
    };

    const { isPathSelected, setSelectedPath } = useSelection();
    const [isHovered, setIsHovered] = React.useState(false);
    const isSelected = isPathSelected(path);

    const accentColor = isSelected ? '#D65E98' : '#D474A8';

    const [menuOpen, setMenuOpen] = React.useState(false);
    const { registerOverflowElement, unregisterOverflowElement } = useOverflowContext();
    const handleRef = React.useRef<HTMLDivElement | null>(null);
    // Anchor map for per-key inline actions (rename/delete) rendered via portal
    const keyAnchorMapRef = React.useRef<Map<string, HTMLElement>>(new Map());

    // Render per-key inline actions (rename/delete) via portal so it can overflow
    React.useEffect(() => {
        const currentKey = actionKey;
        if (!currentKey || readonly) return;
        const anchor = keyAnchorMapRef.current.get(currentKey);
        if (!anchor) return;

        const menuId = `dict-key-actions-${path}-${currentKey}`;
        let rafId: number | null = null;

        const updatePosition = () => {
            const rect = anchor.getBoundingClientRect();
            const gap = 6;
            const top = rect.top - gap;
            const left = rect.left + rect.width / 2;

            const element = (
                <div
                    className="rjft-key-inline-actions"
                    style={{ position: 'fixed', top, left, transform: 'translate(-50%, -100%)' }}
                >
                    {renamingKey === currentKey ? (
                        <div className="flex items-center gap-[6px] bg-[#252525] p-[4px] rounded-[6px] border border-[#404040] shadow-lg">
                            <input
                                value={renameInput}
                                onChange={(e) => setRenameInput(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') { e.preventDefault(); submitRenameKey(currentKey); }
                                    if (e.key === 'Escape') { e.preventDefault(); setRenamingKey(null); }
                                }}
                                className="h-[24px] w-[128px] text-[12px] bg-[#1E1E1E] text-[#E5E7EB] rounded-[4px] px-[6px] outline-none border border-[#3A3D45]"
                            />
                            <button
                                className="h-[24px] px-[8px] text-[11px] rounded-[4px] bg-[#2a2a2a] hover:bg-[#3E3E41] border border-[#6D7177]/40 text-[#E5E7EB]"
                                onClick={(e) => { e.stopPropagation(); submitRenameKey(currentKey); }}
                            >
                                save
                            </button>
                            <button
                                className="h-[24px] px-[8px] text-[11px] rounded-[4px] bg-[#2a2a2a] hover:bg-[#3E3E41] border border-[#6D7177]/40 text-[#E5E7EB]"
                                onClick={(e) => { e.stopPropagation(); setRenamingKey(null); }}
                            >
                                cancel
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-[6px] bg-[#252525] p-[4px] rounded-[6px] border border-[#404040] shadow-lg">
                            <button
                                className="h-[22px] w-[22px] rounded-[4px] bg-[#2a2a2a] hover:bg-[#3E3E41] border border-[#6D7177]/40 flex items-center justify-center"
                                title="Rename key"
                                onClick={(e) => { e.stopPropagation(); beginRenameKey(currentKey); }}
                            >
                                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="#E5E7EB" strokeWidth="1.6">
                                    <path d="M4 13.5V16h2.5L15 7.5 12.5 5 4 13.5z"/>
                                    <path d="M11 6l3 3"/>
                                </svg>
                            </button>
                            <button
                                className="h-[22px] w-[22px] rounded-[4px] bg-[#2a2a2a] hover:bg-[#3E3E41] border border-[#6D7177]/40 flex items-center justify-center"
                                title="Delete key"
                                onClick={(e) => { e.stopPropagation(); deleteKey(currentKey); setActionKey(null); }}
                            >
                                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="#F44336" strokeWidth="1.6">
                                    <path d="M6 6h8m-7 2.5V15a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V8.5M8 6V4.8A1.8 1.8 0 0 1 9.8 3h0.4A1.8 1.8 0 0 1 12 4.8V6" strokeLinecap="round"/>
                                </svg>
                            </button>
                        </div>
                    )}
                </div>
            );

            registerOverflowElement(menuId, element, anchor);
        };

        const loop = () => {
            updatePosition();
            rafId = requestAnimationFrame(loop);
        };
        loop();

        const onScroll = () => updatePosition();
        const onResize = () => updatePosition();
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onResize);

        return () => {
            if (rafId) cancelAnimationFrame(rafId);
            unregisterOverflowElement(menuId);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onResize);
        };
    }, [actionKey, renamingKey, renameInput, readonly, path, registerOverflowElement, unregisterOverflowElement]);

    React.useEffect(() => {
        const menuId = `dict-menu-${path}`;
        if (!menuOpen || !handleRef.current) return;

        let rafId: number | null = null;

        const updatePosition = () => {
            if (!handleRef.current) return;
            const rect = handleRef.current.getBoundingClientRect();
            const gap = 8;

            const top = rect.top;

            const left = rect.left - gap;

            registerOverflowElement(
                menuId,
                (

                    <div style={{ position: 'fixed', top, left, transform: 'translateX(-100%)' }}>

                        <DictActionMenu
                            value={data}
                            onClear={() => { onUpdate({}); setMenuOpen(false); }}
                            onTransferToList={() => { onReplace && onReplace([null, null]); setMenuOpen(false); }}
                            onTransferToText={() => { onReplace && onReplace(''); setMenuOpen(false); }}
                            onPaste={async () => {
                                let payload: any = getClipboard();
                                if (!payload) {
                                    try {
                                        const text = await navigator.clipboard.readText();
                                        payload = text?.startsWith('__RJF__') ? JSON.parse(text.slice('__RJF__'.length)) : JSON.parse(text);
                                    } catch {}
                                }
                                if (payload !== undefined) {
                                    if (Array.isArray(payload)) {
                                        onReplace && onReplace(payload);
                                    } else if (payload && typeof payload === 'object') {
                                        onUpdate(payload);
                                    } else if (typeof payload === 'string') {
                                        onReplace && onReplace(payload);
                                    }
                                }
                                setMenuOpen(false);
                            }}
                        />
                    </div>
                ),
                handleRef.current
            );
        };

        const loop = () => {
            updatePosition();
            rafId = requestAnimationFrame(loop);
        };
        loop();

        const onDocClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (handleRef.current && handleRef.current.contains(target)) return;
            if (target.closest('.rjft-action-menu')) return;
            setMenuOpen(false);
        };
        const onScroll = () => updatePosition();
        const onResize = () => updatePosition();
        document.addEventListener('mousedown', onDocClick, true);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onResize);

        return () => {
            if (rafId) cancelAnimationFrame(rafId);
            unregisterOverflowElement(menuId);
            document.removeEventListener('mousedown', onDocClick, true);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onResize);
        };
    }, [menuOpen, data, onUpdate, onReplace, path, registerOverflowElement, unregisterOverflowElement]);

    // Ensure only one menu is open globally
    React.useEffect(() => {
        const onCloseAll = () => setMenuOpen(false);
        window.addEventListener('rjft:close-all-menus', onCloseAll as EventListener);
        return () => window.removeEventListener('rjft:close-all-menus', onCloseAll as EventListener);
    }, []);

    return (
        <div 
            className={`bg-[#252525] shadow-sm relative group group/dict p-[2px]`}
            style={{ outline: 'none', boxShadow: isSelected ? 'inset 0 0 0 2px #C74F8A' : 'none' }}
            onClick={(e) => { e.stopPropagation(); setSelectedPath(path); }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <div 
                className="absolute left-0 top-1 bottom-1 w-px bg-[#A23F70] rounded-full z-20"
            >
                {(isSelected || isHovered || menuOpen) && (
                    <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                        <div

                            className="w-4 h-6 bg-[#252525] border-2 rounded-[3px] flex flex-col items-center justify-center gap-0.5 shadow-lg cursor-pointer pointer-events-auto"
                            style={{ borderColor: accentColor }}
                            aria-hidden
                            onClick={(e) => { 
                                e.stopPropagation(); 
                                setSelectedPath(path);
                                if (menuOpen) {
                                    setMenuOpen(false);
                                } else {
                                    window.dispatchEvent(new CustomEvent('rjft:close-all-menus'));
                                    setMenuOpen(true);
                                }

                            }}
                            ref={handleRef}
                        >
                            <div className="w-0.5 h-0.5 rounded-full" style={{ backgroundColor: accentColor }}></div>
                            <div className="w-0.5 h-0.5 rounded-full" style={{ backgroundColor: accentColor }}></div>
                            <div className="w-0.5 h-0.5 rounded-full" style={{ backgroundColor: accentColor }}></div>
                        </div>
                    </div>
                )}
            </div>
            {/* menu rendered via portal */}
            <div 
                className={`space-y-0 transition-all duration-200`}
                
            >
                {keys.length === 0 ? (
                    <div className="w-full px-[16px] py-[8px] bg-transparent rounded-md overflow-hidden transition-colors duration-200">
                        <div className="flex items-center h-[24px]">
                            <div className="text-[#6D7177] text-[12px] italic leading-normal font-plus-jakarta-sans">
                                empty object
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        {keys.map((key, index) => {
                            const keyPath = getKeyPath(key);
                            const isKeyHovered = isPathHovered(keyPath);
                            const showDropIndicator = false; // DnD disabled
                            
                            return (
                                <React.Fragment key={key}>
                                    {/* Drop Indicator - Before - Enhanced */}
                                    {showDropIndicator && dragOverPosition === 'before' && (
                                        <div className="relative">
                                            <div className="absolute inset-x-0 -top-[2px] h-[3px] bg-gradient-to-r from-blue-400 to-blue-500 z-40 rounded-full shadow-lg animate-pulse">
                                                <div className="absolute left-2 -top-1.5 w-3 h-3 bg-blue-400 rounded-full shadow-md"></div>
                                                <div className="absolute right-2 -top-1.5 w-3 h-3 bg-blue-500 rounded-full shadow-md opacity-60"></div>
                                            </div>
                                        </div>
                                    )}
                                    
                                    <div 
                                        className={`group relative transition-all duration-200 ${
                                            showDropIndicator && dragOverKey === key
                                                ? 'bg-blue-400/20 ring-2 ring-blue-400/50'
                                                : isKeyHovered 
                                                    ? 'bg-[#CDCDCD]/10' 
                                                    : 'hover:bg-[#6D7177]/10'
                                        }`}
                                        
                                    >
                                        <div className="flex items-stretch">
                                            {/* Key section - display only */}
                                            <div className="flex-shrink-0 flex justify-center">
                                                <div 

                                                    className="relative w-[64px] h-full pt-[4px] bg-[#1C1D1F]/50 overflow-visible transition-colors duration-200 flex justify-center"

                                                    onMouseEnter={() => handleKeyHover(key, true)}
                                                    onMouseLeave={() => handleKeyHover(key, false)}
                                                >
                                                    <span 
                                                        className={`text-[10px] leading-[28px] font-plus-jakarta-sans truncate max-w-full not-italic inline-block mt-[2px] transition-colors duration-200
                                                            ${isKeyHovered
                                                                ? 'text-[#B1457A]'
                                                                : 'text-[#C74F8A] hover:text-[#D96BA0]'
                                                            }`}
                                                        title={key}
                                                        ref={(el) => {
                                                            if (el) {
                                                                keyAnchorMapRef.current.set(key, el);
                                                            } else {
                                                                keyAnchorMapRef.current.delete(key);
                                                            }
                                                        }}
                                                        onClick={(e) => { 
                                                            e.stopPropagation(); 
                                                            setSelectedPath(path);
                                                            setActionKey(prev => prev === key ? null : key); 
                                                            setRenamingKey(null); 
                                                        }}
                                                    >
                                                        {key}
                                                    </span>
                                                </div>
                                            </div>
                                            
                                            
                                            {/* Content */}
                                            <div className="flex-1 min-w-0">
                                                <ComponentRenderer
                                                    data={data[key]}
                                                    path={keyPath}
                                                    readonly={readonly}
                                                    parentKey={key}
                                                    onUpdate={(newValue) => updateValue(key, newValue)}
                                                    onDelete={() => deleteKey(key)}
                                                    preventParentDrag={preventParentDrag}
                                                    allowParentDrag={allowParentDrag}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {/* Drop Indicator - After - Enhanced */}
                                    {showDropIndicator && dragOverPosition === 'after' && (
                                        <div className="relative">
                                            <div className="absolute inset-x-0 top-[2px] h-[3px] bg-gradient-to-r from-blue-400 to-blue-500 z-40 rounded-full shadow-lg animate-pulse">
                                                <div className="absolute left-2 -top-1.5 w-3 h-3 bg-blue-400 rounded-full shadow-md"></div>
                                                <div className="absolute right-2 -top-1.5 w-3 h-3 bg-blue-500 rounded-full shadow-md opacity-60"></div>
                                            </div>
                                        </div>
                                    )}
                                    
                                    {/* Horizontal Divider Line */}
                                    {index < keys.length - 1 && (
                                        <div className="w-full h-[1px] bg-[#3A3D41] my-[4px]"></div>
                                    )}
                                </React.Fragment>
                            );
                        })}
                        
                    </>
                )}
            </div>
            {/* Add New Key Button at bottom - visible on hover/selected/menuOpen or when empty */}
            {!readonly && (
                <div className="absolute -bottom-3 left-[36px] z-30 transform -translate-x-1/2">
                    <button
                        onClick={addEmptyKey}
                        className={`group w-6 h-6 flex items-center justify-center rounded-full 
                                 bg-[#2a2a2a] hover:bg-[#3a3a3a] border border-[#6D7177]/40 hover:border-[#6D7177]/60 
                                 transition-all duration-200 ease-out shadow-lg 
                                 ${(isHovered || isSelected || menuOpen) ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
                        title="Add new key"
                    >
                        <svg 
                            className="w-3 h-3 text-[#E5E7EB] transition-transform duration-200 group-hover:scale-110" 
                            viewBox="0 0 16 16" 
                            fill="none" 
                            stroke="currentColor" 
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="M8 3v10M3 8h10" />
                        </svg>
                    </button>
                </div>
            )}
        </div>
    );
};

export default DictComponent;