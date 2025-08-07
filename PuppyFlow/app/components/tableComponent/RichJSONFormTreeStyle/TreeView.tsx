'use client'
import React from 'react';
import TreeNode from './TreeNode';
import { useTreeContext } from './TreeContext';

type TreeViewProps = {
    data: any;
    readonly?: boolean;
    onUpdate: (newData: any) => void;
    preventParentDrag: () => void;
    allowParentDrag: () => void;
};

const TreeView = ({
    data,
    readonly = false,
    onUpdate,
    preventParentDrag,
    allowParentDrag
}: TreeViewProps) => {
    const { expandNode } = useTreeContext();

    React.useEffect(() => {
        // Ensure root is expanded by default
        expandNode('');
    }, [expandNode]);

    const handleRootUpdate = (newData: any) => {
        onUpdate(newData);
    };

    return (
        <div className="w-full h-full overflow-auto bg-white">
            <div className="p-6 min-h-full">
                <div className="max-w-none">
                    <TreeNode
                        data={data}
                        path=""
                        parentType="root"
                        depth={0}
                        readonly={readonly}
                        onUpdate={handleRootUpdate}
                    />
                </div>
            </div>
        </div>
    );
};

export default TreeView;