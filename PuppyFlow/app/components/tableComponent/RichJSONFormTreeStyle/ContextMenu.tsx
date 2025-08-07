'use client'
import React, { useEffect, useRef } from 'react';
import TypeSelector from './TypeSelector';

type ContextMenuProps = {
    x: number;
    y: number;
    onClose: () => void;
    onCopy: () => void;
    onCopyPath: () => void;
    onClear: () => void;
    onDelete?: () => void;
    onChangeType?: (type: 'text' | 'dict' | 'list') => void;
    onAddSibling?: (type: 'text' | 'dict' | 'list') => void;
    onAddChild?: (type: 'text' | 'dict' | 'list') => void;
    canAddChild?: boolean;
    canDelete?: boolean;
    path: string;
};

const ContextMenu = ({
    x,
    y,
    onClose,
    onCopy,
    onCopyPath,
    onClear,
    onDelete,
    onChangeType,
    onAddSibling,
    onAddChild,
    canAddChild = false,
    canDelete = false,
    path
}: ContextMenuProps) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const [showTypeSelector, setShowTypeSelector] = React.useState<'change' | 'sibling' | 'child' | null>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose]);

    // Adjust position to keep menu in viewport
    const adjustedPosition = React.useMemo(() => {
        const menuWidth = 200;
        const menuHeight = 300; // Approximate
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let adjustedX = x;
        let adjustedY = y;

        if (x + menuWidth > viewportWidth) {
            adjustedX = x - menuWidth;
        }

        if (y + menuHeight > viewportHeight) {
            adjustedY = y - menuHeight;
        }

        return { x: Math.max(0, adjustedX), y: Math.max(0, adjustedY) };
    }, [x, y]);

    const handleTypeSelection = (type: 'text' | 'dict' | 'list') => {
        if (showTypeSelector === 'change' && onChangeType) {
            onChangeType(type);
        } else if (showTypeSelector === 'sibling' && onAddSibling) {
            onAddSibling(type);
        } else if (showTypeSelector === 'child' && onAddChild) {
            onAddChild(type);
        }
        setShowTypeSelector(null);
        onClose();
    };

    const menuItems = [
        {
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
            ),
            label: 'Copy Value',
            action: onCopy,
            className: 'text-[#374151] hover:text-[#111827]'
        },
        {
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.102m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
            ),
            label: 'Copy Path',
            action: onCopyPath,
            className: 'text-[#374151] hover:text-[#111827]'
        },
        'divider',
        {
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
            ),
            label: 'Add Sibling',
            action: () => setShowTypeSelector('sibling'),
            className: 'text-[#059669] hover:text-[#047857]',
            disabled: !onAddSibling
        },
        canAddChild && {
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
            ),
            label: 'Add Child',
            action: () => setShowTypeSelector('child'),
            className: 'text-[#059669] hover:text-[#047857]'
        },
        'divider',
        onChangeType && {
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
            ),
            label: 'Change Type',
            action: () => setShowTypeSelector('change'),
            className: 'text-[#7C3AED] hover:text-[#6B21A8]'
        },
        {
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
            ),
            label: 'Clear',
            action: onClear,
            className: 'text-[#DC2626] hover:text-[#B91C1C]'
        },
        canDelete && 'divider',
        canDelete && {
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            ),
            label: 'Delete',
            action: onDelete,
            className: 'text-[#DC2626] hover:text-[#B91C1C]'
        }
    ].filter(Boolean);

    return (
        <div
            ref={menuRef}
            className="fixed z-[9999] bg-white border border-[#D1D5DB] rounded-lg shadow-lg py-1 min-w-[160px]"
            style={{
                left: adjustedPosition.x,
                top: adjustedPosition.y
            }}
        >
            {showTypeSelector ? (
                <div className="p-3">
                    <div className="text-sm text-[#6B7280] mb-2 font-medium">
                        {showTypeSelector === 'change' && 'Change to:'}
                        {showTypeSelector === 'sibling' && 'Add sibling:'}
                        {showTypeSelector === 'child' && 'Add child:'}
                    </div>
                    <TypeSelector
                        onTypeSelect={handleTypeSelection}
                        onCancel={() => setShowTypeSelector(null)}
                        size="compact"
                    />
                </div>
            ) : (
                menuItems.map((item, index) => {
                    if (item === 'divider') {
                        return <div key={index} className="border-t border-[#E5E7EB] my-1" />;
                    }

                    const menuItem = item as any;
                    if (menuItem.disabled) {
                        return null;
                    }

                    return (
                        <button
                            key={index}
                            onClick={menuItem.action}
                            className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-[#F3F4F6] ${menuItem.className}`}
                        >
                            {menuItem.icon}
                            {menuItem.label}
                        </button>
                    );
                })
            )}
        </div>
    );
};

export default ContextMenu;