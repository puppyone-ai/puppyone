'use client'
import React, { useState } from 'react';
import { useHover } from './ComponentRenderer';
import TextEditor from '../TextEditor';

type TextComponentProps = {
    data: string;
    path: string;
    readonly?: boolean;
    onEdit: (path: string, newValue: string) => void;
    onDelete?: () => void; // 新增：删除整个文本字段的回调
    preventParentDrag: () => void;
    allowParentDrag: () => void;
}

const TextComponent = ({ 
    data, 
    path,
    readonly = false, 
    onEdit, 
    onDelete,
    preventParentDrag, 
    allowParentDrag 
}: TextComponentProps) => {
    const [showMenu, setShowMenu] = useState(false);
    const { setHoveredPath, isPathHovered } = useHover();
    const isTextHovered = isPathHovered(path);

    const handleEditChange = (newValue: string) => {
        if (!readonly) {
            onEdit(path, newValue);
        }
    };

    const handleTextHover = (isEntering: boolean) => {
        if (isEntering) {
            setHoveredPath(path);
        } else {
            setHoveredPath(null);
        }
    };

    const handleMenuClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setShowMenu(!showMenu);
    };

    const handleCopyText = () => {
        navigator.clipboard.writeText(data);
        setShowMenu(false);
    };

    const handleClearText = () => {
        // Clear: set text to null
        onEdit(path, null as any);
        setShowMenu(false);
    };

    const handleDeleteText = () => {
        // Delete: 删除整个文本字段（包括其在父结构中的键/索引）
        if (onDelete) {
            onDelete();
        } else {
            console.log('Delete text field requested but no onDelete callback provided');
        }
        setShowMenu(false);
    };

    const handleEmptyText = () => {
        // Empty: set text to empty string
        onEdit(path, '');
        setShowMenu(false);
    };

    // Close menu when clicking outside or mouse leaves
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

    return (
        <div className="w-full relative group/text">
            <div className="absolute left-0 top-1 bottom-1 w-[2px] bg-[#CDCDCD]/40 rounded-full">
                <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#CDCDCD]/40 rounded-full transition-all duration-200 group-hover/text:w-[4px] group-hover/text:left-[-1px]"></div>
                <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover/text:opacity-100 transition-opacity duration-200 z-50">
                    <button
                        onClick={handleMenuClick}
                        className="w-4 h-6 bg-[#252525] border border-[#CDCDCD]/30 rounded-[3px] flex flex-col items-center justify-center gap-0.5 shadow-lg hover:bg-[#2a2a2a] transition-colors duration-200"
                        title="Text options"
                    >
                        <div className="w-0.5 h-0.5 bg-[#CDCDCD]/60 rounded-full"></div>
                        <div className="w-0.5 h-0.5 bg-[#CDCDCD]/60 rounded-full"></div>
                        <div className="w-0.5 h-0.5 bg-[#CDCDCD]/60 rounded-full"></div>
                    </button>
                    
                    {/* Menu for text */}
                    {showMenu && (
                        <div 
                            className="absolute left-6 top-0 w-[128px] bg-[#252525] p-[8px] border-[1px] border-[#404040] rounded-[8px] gap-[4px] flex flex-col shadow-2xl"
                            style={{ zIndex: 9999999 }}
                            onMouseLeave={handleMenuMouseLeave}
                        >
                            <button
                                onClick={handleCopyText}
                                className="px-[0px] rounded-[4px] bg-inherit hover:bg-[#3E3E41] w-full h-[26px] flex justify-start items-center text-[#CDCDCD] hover:text-white font-plus-jakarta-sans text-[12px] font-[400] tracking-[0.5px] cursor-pointer whitespace-nowrap gap-[8px]"
                            >
                                <div className="flex justify-center items-center">
                                    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M8 6H16C16.5523 6 17 6.44772 17 7V15C17 15.5523 16.5523 16 16 16H8C7.44772 16 7 15.5523 7 15V7C7 6.44772 7.44772 6 8 6Z" stroke="#BEBEBE" strokeWidth="1.5" fill="none"/>
                                        <path d="M10 4H18C18.5523 4 19 4.44772 19 5V13" stroke="#BEBEBE" strokeWidth="1.5" fill="none"/>
                                    </svg>
                                </div>
                                Copy
                            </button>
                            
                            <button
                                onClick={handleClearText}
                                className="px-[0px] rounded-[4px] bg-inherit hover:bg-[#3E3E41] w-full h-[26px] flex justify-start items-center text-[#F44336] hover:text-[#FF6B64] font-plus-jakarta-sans text-[12px] font-[400] tracking-[0.5px] cursor-pointer whitespace-nowrap gap-[8px]"
                            >
                                <div className="flex justify-center items-center">
                                    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <rect x="7" y="9" width="12" height="10" rx="1" stroke="#F44336" strokeWidth="1.5"/>
                                        <path d="M10 6H16" stroke="#F44336" strokeWidth="1.5" strokeLinecap="round"/>
                                        <path d="M8 9H18" stroke="#F44336" strokeWidth="1.5" strokeLinecap="round"/>
                                        <path d="M11 12V16" stroke="#F44336" strokeWidth="1.5" strokeLinecap="round"/>
                                        <path d="M15 12V16" stroke="#F44336" strokeWidth="1.5" strokeLinecap="round"/>
                                    </svg>
                                </div>
                                Clear
                            </button>
                        </div>
                    )}
                </div>
            </div>
            <div 
                className={`w-full px-[16px] py-[8px] bg-transparent overflow-hidden transition-colors duration-200 ${
                    isTextHovered ? 'bg-[#CDCDCD]/10' : 'hover:bg-[#6D7177]/10'
                } ${readonly ? 'opacity-60' : ''}`}
                onMouseEnter={() => handleTextHover(true)}
                onMouseLeave={() => handleTextHover(false)}
            >
                <TextEditor
                    preventParentDrag={preventParentDrag}
                    allowParentDrag={allowParentDrag}
                    value={data}
                    onChange={readonly ? () => {} : handleEditChange}
                    placeholder="Enter text content..."
                    widthStyle={0}
                    autoHeight={true}
                />
            </div>
        </div>
    );
};

export default TextComponent; 