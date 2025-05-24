'use client'

import { useCallback } from 'react';
import { Node, useReactFlow } from '@xyflow/react';
import { VectorIndexingItem, IndexingItem, BaseIndexingItem } from '../JsonNodeNew';
import { PuppyStorage_IP_address_for_embedding } from '../../../hooks/useJsonConstructUtils';

interface PathSegment {
  id: string;
  type: 'key' | 'num';
  value: string;
}

// 索引状态类型 - 添加 deleting 状态
export type VectorIndexingStatus = 'notStarted' | 'processing' | 'done' | 'error' | 'deleting';

export default function useIndexingUtils() {
  const { getNode } = useReactFlow();

  // 辅助函数：访问指定路径的值
  const getValueByPath = (source: any, path: PathSegment[]): any => {
    if (!source || path.length === 0) return source;
    
    let result = source;
    
    try {
      // 遍历路径，深入嵌套对象
      for (const segment of path) {
        if (result && typeof result === 'object') {
          // 根据 segment.type 决定如何访问
          const key = segment.type === 'num' && !isNaN(Number(segment.value))
            ? Number(segment.value)
            : segment.value;
          result = result[key];
        } else {
          throw new Error('无法访问路径');
        }
      }
      return result;
    } catch (error) {
      console.error('路径解析错误:', error);
      return 'Path Error';
    }
  };

  // 添加索引方法 - 修改为返回更新后的 IndexingItem 数组
  const handleAddIndex = useCallback(
    async (
      id: string, 
      newItem: IndexingItem, 
      currentIndexingList: IndexingItem[], 
      setVectorIndexingStatus: (status: VectorIndexingStatus) => void,
      getUserId: () => Promise<string | null>
    ): Promise<IndexingItem[] | null> => {
      // 如果是向量索引，需要处理 chunks 数据
      if (newItem.type === 'vector') {
        // 获取节点内容作为处理数据源
        let dataSource: any[] = [];
        try {
          const node = getNode(id);
          if (node && node.data && node.data.content) {
            const content = typeof node.data.content === 'string'
              ? JSON.parse(node.data.content)
              : node.data.content;
            
            // 如果内容是数组，直接使用，否则包装成数组
            dataSource = Array.isArray(content) ? content : [content];
          }
        } catch (error) {
          console.error('Error parsing content for indexing:', error);
          dataSource = [];
        }
        
        // 准备 chunks 数据
        const chunks = [];
        
        // 处理每个数据源，生成 chunks
        for (let i = 0; i < dataSource.length; i++) {
          const source = dataSource[i];
          
          // 获取键路径结果作为 index_content
          const indexContent = getValueByPath(source, (newItem as VectorIndexingItem).key_path);
          
          // 获取值路径结果作为原始 metadata 内容
          const retrievalContent = getValueByPath(source, (newItem as VectorIndexingItem).value_path);
          
          // 创建包含序号 id 的新 metadata 对象
          const metadata = {
            retrieval_content: retrievalContent,
            id: i  // 使用循环索引作为 id
          };
          
          // 创建 chunk 对象并添加到 chunks 数组
          chunks.push({
            "content": indexContent,
            "metadata": metadata
          });
        }
        
        // 更新 newItem 的 chunks 字段
        (newItem as VectorIndexingItem).chunks = chunks;
        
        // 开始处理embedding请求
        try {
          // 设置向量索引状态为处理中
          setVectorIndexingStatus('processing');
          
          // 构建请求体
          const payloadData = {
            chunks: (newItem as VectorIndexingItem).chunks,
            create_new: true,
            vdb_type: "pgvector",
            model: "text-embedding-ada-002",
            set_name: `collection_${id}_${Date.now()}`
          };
          
          // 检查chunks是否有效
          if (!payloadData.chunks || payloadData.chunks.length === 0) {
            setVectorIndexingStatus('notStarted');
            throw new Error("No valid chunks to embed");
          }
          
          // 发送请求到后端
          const response = await fetch(`${PuppyStorage_IP_address_for_embedding}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payloadData)
          });
          
          if (!response.ok) {
            setVectorIndexingStatus('notStarted');
            throw new Error(`HTTP Error: ${response.status}`);
          }
          
          // 获取响应数据
          const indexNameResponse = await response.json();
          console.log("index_name_response", indexNameResponse);
          
          // 获取用户ID
          const userId = await getUserId();
          
          if (indexNameResponse.collection_name) {
            // 更新向量索引项的信息
            (newItem as VectorIndexingItem).index_name = indexNameResponse.collection_name;
            (newItem as VectorIndexingItem).collection_configs = {
              set_name: indexNameResponse.set_name,
              model: payloadData.model,
              vdb_type: payloadData.vdb_type,
              user_id: userId || "default_user",
              collection_name: indexNameResponse.collection_name
            };
            
            // 确保嵌入状态保持为完成
            setVectorIndexingStatus('done');
            
            console.log("Updated vector indexing with collection name:", indexNameResponse.collection_name);
          }
        } catch (error) {
          console.error("Error creating vector index:", error);
          setVectorIndexingStatus('error');
          return null; // 出错时返回null
        }
      }
      
      // 创建一个新的索引列表，包含现有的索引和新添加的索引
      const newIndexingList = [...currentIndexingList, newItem];
      
      // 返回新的索引列表，而不是直接更新节点
      return newIndexingList;
    },
    [getNode]
  );

  // 修改移除索引方法 - 支持删除中状态
  const handleRemoveIndex = useCallback(async (
    index: number,
    currentIndexingList: IndexingItem[],
    nodeId: string,
    getUserId: () => Promise<string | null>,
    setVectorIndexingStatus: (status: VectorIndexingStatus) => void
  ): Promise<{ success: boolean, newList: IndexingItem[] }> => {
    // 创建一个新的列表副本进行操作
    const newIndexingList = [...currentIndexingList];
    const itemToRemove = newIndexingList[index];
    
    // 删除结果标志
    let deleteSuccess = true;
    
    // 如果是向量索引类型，需要调用后端接口删除数据库中的集合
    if (itemToRemove && itemToRemove.type === 'vector') {
      const vectorItem = itemToRemove as VectorIndexingItem;
      
      try {
        // 获取用户ID
        const userId = await getUserId() || 'default_user';
        
        // 准备请求参数
        const deleteParams = {
          vdb_type: vectorItem.collection_configs.vdb_type || 'pgvector',
          user_id: userId,
          model: vectorItem.collection_configs.model || 'text-embedding-ada-002',
          set_name: vectorItem.collection_configs.set_name
        };
        
        // 发送删除请求到向量存储服务
        const response = await fetch(`${PuppyStorage_IP_address_for_embedding.replace('/embed', '/delete')}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(deleteParams)
        });
        
        if (!response.ok) {
          deleteSuccess = false;
          throw new Error(`Failed to delete collection: ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log('Delete collection response:', result);
        
        // 设置状态为成功
        setVectorIndexingStatus('done');
      } catch (error) {
        console.error('Error deleting vector collection:', error);
        deleteSuccess = false;
        // 设置状态为错误
        setVectorIndexingStatus('error');
      }
    }
    
    // 只有在删除成功时才从列表中移除该索引，否则将状态设为错误
    if (deleteSuccess) {
      newIndexingList.splice(index, 1);
    } else if (itemToRemove && itemToRemove.type === 'vector') {
      // 如果删除失败，将状态设置为错误
      (itemToRemove as VectorIndexingItem).status = 'error';
    }
    
    return { 
      success: deleteSuccess, 
      newList: newIndexingList 
    };
  }, []);

  return {
    handleAddIndex,
    handleRemoveIndex
  };
}

