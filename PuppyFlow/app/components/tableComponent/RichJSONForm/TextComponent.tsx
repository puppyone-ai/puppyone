'use client'
import React from 'react';
import TextEditor from '../TextEditor';

type TextComponentProps = {
    data: string;
    path: string;
    readonly?: boolean;
    isRoot?: boolean;
    onEdit: (path: string, value: string) => void;
    preventParentDrag: () => void;
    allowParentDrag: () => void;
}

const TextComponent = ({ 
    data, 
    path, 
    readonly = false, 
    isRoot = false, 
    onEdit, 
    preventParentDrag, 
    allowParentDrag 
}: TextComponentProps) => {

    const handleEditChange = (newValue: string) => {
        if (!readonly) {
            onEdit(path, newValue);
        }
    };

    return (
        <div className="w-full">
            <div className={`w-full p-[8px] bg-[#2a2a2a] rounded-md overflow-hidden ${readonly ? 'opacity-60' : ''}`}>
                <TextEditor
                    preventParentDrag={preventParentDrag}
                    allowParentDrag={allowParentDrag}
                    value={data}
                    onChange={handleEditChange}
                    placeholder="Enter text content..."
                    widthStyle={0}
                    autoHeight={true}
                />
            </div>
        </div>
    );
};

export default TextComponent; 