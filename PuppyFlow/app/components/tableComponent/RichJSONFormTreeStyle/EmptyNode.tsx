'use client'
import React, { useState } from 'react';
import TypeSelector from './TypeSelector';

type EmptyNodeProps = {
    data: any;
    path: string;
    parentKey?: string | number;
    parentType?: 'dict' | 'list' | 'root';
    depth?: number;
    readonly?: boolean;
    onUpdate: (newData: any) => void;
    onDelete?: () => void;
};

const EmptyNode = ({
    data,
    path,
    parentKey,
    parentType = 'root',
    depth = 0,
    readonly = false,
    onUpdate,
    onDelete
}: EmptyNodeProps) => {
    const [showTypeSelector, setShowTypeSelector] = useState(false);

    const handleTypeSelect = (type: 'text' | 'dict' | 'list') => {
        let newValue;
        
        switch (type) {
            case 'text':
                newValue = '';
                break;
            case 'dict':
                newValue = {};
                break;
            case 'list':
                newValue = [];
                break;
        }
        
        onUpdate(newValue);
        setShowTypeSelector(false);
    };

    if (readonly) {
        return (
            <div className="flex items-center text-sm text-[#6B7280] italic">
                <svg className="w-4 h-4 mr-2 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                null
            </div>
        );
    }

    return (
        <div className="flex items-center w-full">
            {showTypeSelector ? (
                <div className="w-full">
                    <TypeSelector
                        onTypeSelect={handleTypeSelect}
                        onCancel={() => setShowTypeSelector(false)}
                        size="compact"
                    />
                </div>
            ) : (
                <button
                    onClick={() => setShowTypeSelector(true)}
                    className="flex items-center text-sm text-[#9CA3AF] hover:text-[#374151] transition-colors group"
                >
                    <svg className="w-4 h-4 mr-2 text-[#9CA3AF] group-hover:text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="italic">Select data type</span>
                </button>
            )}
        </div>
    );
};

export default EmptyNode;