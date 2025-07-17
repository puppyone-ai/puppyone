# GroupNode 提交流程文档

## 概述

GroupNode 的提交流程是一个复杂的多步骤过程，旨在确保只有相关的节点被提交到后端，同时保持工作流的完整性和正确性。本文档详细描述了从组内节点识别到后端提交的完整流程。

## 核心设计原则

1. **边界明确性**: 只有与组内 block nodes 相关的 edge nodes 才会被提交
2. **工作流完整性**: 确保提交的工作流有完整的输入和输出链路
3. **数据一致性**: 避免重复节点，确保数据的唯一性
4. **状态管理**: 正确管理节点的加载状态，区分输入和输出节点

## 详细流程

### 步骤1: 识别组内的 Block Nodes

#### 目标
找到当前组内所有的 block nodes，作为后续流程的起始点。

#### 实现逻辑
```typescript
const getGroupBlockNodes = () => {
    const allNodes = getNodes();
    const blockNodeTypes = ['text', 'file', 'weblink', 'structured'];
    
    const groupBlockNodes = allNodes.filter(node => {
        const groupIds = (node.data as any)?.groupIds;
        const isInGroup = Array.isArray(groupIds) && groupIds.includes(groupNodeId);
        const isBlockNode = blockNodeTypes.includes(node.type || '');
        return isInGroup && isBlockNode;
    });
    
    return groupBlockNodes.map(node => ({
        id: node.id,
        label: String(node.data?.label || node.id)
    }));
};
```

#### 关键点
- 检查节点的 `groupIds` 数组是否包含当前组的ID
- 只考虑 block node 类型：`text`, `file`, `weblink`, `structured`
- 返回节点ID和标签的映射

### 步骤2: 收集相关的 Edge Nodes

#### 目标
基于组内的 block nodes，找到所有与它们相关的 edge nodes（包括输入和输出连接）。

#### 实现逻辑
```typescript
const collectAllRelatedEdgeNodes = (blockNodes: { id: string, label: string }[]) => {
    const allEdgeNodes = new Set<string>();

    blockNodes.forEach(blockNode => {
        // 获取连入该block的edge nodes
        const sourceNodes = getSourceNodeIdWithLabel(blockNode.id, 'edgenode');
        sourceNodes.forEach(sourceNode => {
            allEdgeNodes.add(sourceNode.id);
        });

        // 获取从该block连出的edge nodes
        const targetNodes = getTargetNodeIdWithLabel(blockNode.id, 'edgenode');
        targetNodes.forEach(targetNode => {
            allEdgeNodes.add(targetNode.id);
        });
    });

    return Array.from(allEdgeNodes);
};
```

#### 关键点
- 使用 `getSourceNodeIdWithLabel` 和 `getTargetNodeIdWithLabel` 获取连接关系
- 使用 Set 自动去重
- 考虑双向连接：输入和输出

### 步骤3: 过滤有效的 Edge Nodes

#### 目标
从所有相关的 edge nodes 中筛选出真正需要提交到后端的 edge nodes。

#### 筛选标准
一个 edge node 被认为是有效的，当且仅当：
- 它的 **input** 中至少有一个 block node 在当前组内
- 它的 **output** 中至少有一个 block node 在当前组内

#### 实现逻辑
```typescript
const filterValidEdgeNodes = (edgeNodeIds: string[], groupBlockNodeIds: string[]) => {
    const validEdgeNodes: string[] = [];
    const groupBlockNodeSet = new Set(groupBlockNodeIds);

    edgeNodeIds.forEach(edgeNodeId => {
        // 获取该edge node的输入节点
        const inputNodes = getSourceNodeIdWithLabel(edgeNodeId, 'blocknode');
        const inputNodeIds = inputNodes.map(node => node.id);

        // 获取该edge node的输出节点
        const outputNodes = getTargetNodeIdWithLabel(edgeNodeId, 'blocknode');
        const outputNodeIds = outputNodes.map(node => node.id);

        // 检查条件
        const hasInputInGroup = inputNodeIds.some(nodeId => groupBlockNodeSet.has(nodeId));
        const hasOutputInGroup = outputNodeIds.some(nodeId => groupBlockNodeSet.has(nodeId));

        if (hasInputInGroup && hasOutputInGroup) {
            validEdgeNodes.push(edgeNodeId);
        }
    });

    return validEdgeNodes;
};
```

#### 设计理由
- **确保边界完整性**: 只有与组内节点真正相关的 edge nodes 才会被包含
- **避免孤立节点**: 防止提交与组无关的工作流片段
- **保持逻辑一致性**: 确保工作流的输入和输出都与组相关

### 步骤4: 收集所有相关的 Block Nodes

#### 目标
基于确定的有效 edge nodes，收集所有需要提交到后端的 block nodes。

#### 收集规则
- 收集所有有效 edge nodes 的 **input** block nodes（无论是否在组内）
- 收集所有有效 edge nodes 的 **output** block nodes（无论是否在组内）
- 自动去重相同的 block nodes

#### 实现逻辑
```typescript
const collectAllRelatedBlockNodes = (validEdgeNodeIds: string[]) => {
    const allBlockNodes = new Set<string>();

    validEdgeNodeIds.forEach(edgeNodeId => {
        // 添加所有input block nodes
        const inputNodes = getSourceNodeIdWithLabel(edgeNodeId, 'blocknode');
        inputNodes.forEach(inputNode => {
            allBlockNodes.add(inputNode.id);
        });

        // 添加所有output block nodes
        const outputNodes = getTargetNodeIdWithLabel(edgeNodeId, 'blocknode');
        outputNodes.forEach(outputNode => {
            allBlockNodes.add(outputNode.id);
        });
    });

    return Array.from(allBlockNodes);
};
```

#### 设计理由
- **工作流完整性**: 确保工作流有完整的输入数据（包括组外的input nodes）
- **数据一致性**: 包含所有必要的输出节点
- **自动去重**: 使用 Set 避免重复节点

### 步骤5: 构建后端 JSON

#### 目标
使用确定的 block nodes 和 edge nodes，构建符合后端要求的 JSON 数据结构。

#### 构建过程

##### 5.1 构建 Blocks 对象
```typescript
const blockNodeTypes = ['text', 'file', 'weblink', 'structured'];

allRelatedBlockNodeIds.forEach(blockNodeId => {
    const node = getNode(blockNodeId);
    if (!node || !blockNodeTypes.includes(node.type || '')) return;

    const nodeLabel = node.data?.label || blockNodeId;
    
    try {
        const blockJson = buildBlockNodeJson(blockNodeId);
        blocks[blockNodeId] = {
            ...blockJson,
            label: String(nodeLabel)
        };
    } catch (e) {
        // 回退到默认行为
        blocks[blockNodeId] = {
            label: String(nodeLabel),
            type: node.type || '',
            data: { ...node.data } as BasicNodeData
        };
    }
});
```

##### 5.2 构建 Edges 对象
```typescript
validEdgeNodeIds.forEach(edgeNodeId => {
    try {
        const edgeJson = buildEdgeNodeJson(edgeNodeId);
        edges[edgeNodeId] = edgeJson;
    } catch (e) {
        console.warn(`无法构建边节点 ${edgeNodeId} 的JSON:`, e);
    }
});
```

##### 5.3 去重处理
```typescript
const uniqueEdges: { [key: string]: any } = {};
const edgeSignatures = new Map<string, string>();

Object.entries(edges).forEach(([edgeId, edgeData]) => {
    const signature = JSON.stringify({
        type: edgeData.type,
        data: edgeData.data
    });

    const existingEdgeId = edgeSignatures.get(signature);
    if (existingEdgeId) {
        // 跳过重复的edge
        console.log(`发现重复的边节点: ${edgeId} 与 ${existingEdgeId} 相同`);
    } else {
        edgeSignatures.set(signature, edgeId);
        uniqueEdges[edgeId] = edgeData;
    }
});
```

#### 最终数据结构
```typescript
return {
    blocks: blocks,        // 所有相关的block nodes
    edges: uniqueEdges     // 去重后的edge nodes
};
```

### 步骤6: 管理加载状态

#### 目标
正确设置节点的加载状态，区分输入节点和输出节点。

#### 识别逻辑

##### 6.1 识别作为 Edge Output 的 Block Nodes
```typescript
const blockNodesAsEdgeOutput = new Set<string>();
Object.values(jsonData.edges).forEach(edge => {
    if (edge.data && edge.data.outputs) {
        Object.values(edge.data.outputs).forEach(outputId => {
            if (typeof outputId === 'string') {
                blockNodesAsEdgeOutput.add(outputId);
            }
        });
    }
});
```

##### 6.2 识别开始节点（输入节点）
```typescript
const startBlockNodes = new Set<string>();
Object.keys(jsonData.blocks).forEach(blockId => {
    if (!blockNodesAsEdgeOutput.has(blockId)) {
        startBlockNodes.add(blockId);
    }
});
```

##### 6.3 确定加载状态节点
```typescript
const outputNodeIds = new Set<string>();
groupBlockNodes.forEach(blockNode => {
    // 只有同时满足以下条件的节点才会被设置为加载状态：
    // 1. 在组内
    // 2. 在最终的JSON中
    // 3. 作为某个edge的output
    if (jsonData.blocks[blockNode.id] && blockNodesAsEdgeOutput.has(blockNode.id)) {
        outputNodeIds.add(blockNode.id);
    }
});
```

#### 设计原则
- **输入节点不加载**: 开始节点（不作为任何edge output的节点）不会被设置为加载状态
- **输出节点加载**: 只有会被后端处理和更新的节点才显示加载状态
- **组内优先**: 只有组内的节点才会被设置为加载状态

### 步骤7: 后端提交和响应处理

#### 提交过程
```typescript
const response = await fetch(`${backend_IP_address_for_sendingData}`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
    },
    body: JSON.stringify(jsonData)
});
```

#### 响应处理
```typescript
if (result && result.task_id) {
    const resultNodeIds = Array.from(outputNodeIds);
    await streamResultForMultipleNodes(result.task_id, resultNodeIds);
}
```

## 流程图 