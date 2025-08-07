'use client'
import React from 'react';

type TypeSelectorProps = {
    onTypeSelect: (type: 'text' | 'dict' | 'list') => void;
    onCancel: () => void;
    size?: 'normal' | 'compact';
};

const TypeSelector = ({ onTypeSelect, onCancel, size = 'normal' }: TypeSelectorProps) => {
    const isCompact = size === 'compact';
    
    const buttonClass = isCompact
        ? "flex items-center gap-2 px-3 py-2 rounded-md border border-[#374151] bg-[#1F2937] hover:bg-[#374151] transition-all duration-200 text-sm"
        : "flex flex-col items-center gap-3 p-6 rounded-lg border border-[#374151] bg-[#1F2937] hover:bg-[#374151] transition-all duration-200 min-w-[120px]";

    const iconClass = isCompact ? "w-4 h-4" : "w-8 h-8";
    const labelClass = isCompact ? "text-sm font-medium" : "text-base font-medium";

    return (
        <div className={`${isCompact ? 'flex gap-2' : 'flex flex-col items-center gap-4'}`}>
            {!isCompact && (
                <div className="text-[#9CA3AF] text-sm font-medium mb-2">
                    Select data type
                </div>
            )}
            
            <div className={`${isCompact ? 'flex gap-2' : 'flex gap-4'}`}>
                <button
                    onClick={() => onTypeSelect('text')}
                    className={`${buttonClass} text-[#9CA3AF] hover:text-white group`}
                    title="Create text value"
                >
                    <svg className={`${iconClass} text-[#6B7280] group-hover:text-[#9CA3AF]`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className={labelClass}>Text</span>
                </button>

                <button
                    onClick={() => onTypeSelect('dict')}
                    className={`${buttonClass} text-[#A78BFA] hover:text-[#C4B5FD] group`}
                    title="Create object"
                >
                    <svg className={`${iconClass} text-[#8B5CF6] group-hover:text-[#A78BFA]`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    <span className={labelClass}>Object</span>
                </button>

                <button
                    onClick={() => onTypeSelect('list')}
                    className={`${buttonClass} text-[#FBBF24] hover:text-[#F59E0B] group`}
                    title="Create array"
                >
                    <svg className={`${iconClass} text-[#F59E0B] group-hover:text-[#FBBF24]`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                    </svg>
                    <span className={labelClass}>Array</span>
                </button>
            </div>

            {!isCompact && (
                <button
                    onClick={onCancel}
                    className="mt-2 px-4 py-2 text-sm text-[#6B7280] hover:text-[#9CA3AF] transition-colors"
                >
                    Cancel
                </button>
            )}
        </div>
    );
};

export default TypeSelector;