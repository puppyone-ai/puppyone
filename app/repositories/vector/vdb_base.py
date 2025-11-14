from typing import List, Dict, Any, Optional
from abc import ABC, abstractmethod

class VectorDatabase(ABC):
    """
    向量数据库抽象基类
    
    定义向量数据库操作的通用接口，不同实现可以根据自身特性进行扩展
    """

    _client: Any = None

    def __init__(
        self,
    ):
        pass

    @abstractmethod
    def store_vectors(
        self,
        vectors: List[List[float]],
        contents: List[str],
        metadata: Optional[List[Dict[str, Any]]] = None,
        collection_name: Optional[str] = None,
        **kwargs
    ) -> None:
        """
        存储向量到数据库
        
        Args:
            vectors: 要存储的向量列表
            contents: 与向量对应的内容列表
            metadata: 与向量对应的元数据列表
            collection_name: 集合名称
            **kwargs: 特定实现可能需要的额外参数
        """
        pass

    @abstractmethod
    def search_vectors(
        self,
        collection_name: str,
        query_vector: List[float],
        top_k: int,
        **kwargs
    ) -> List[Dict[str, Any]]:
        """
        在数据库中搜索向量
        
        Args:
            collection_name: 集合名称
            query_vector: 查询向量
            top_k: 返回结果数量
            **kwargs: 特定实现可能需要的额外参数，如:
                      - threshold: 相似度阈值
                      - filters: 元数据过滤条件
                      - metric: 相似度计算方法
        
        Returns:
            包含搜索结果的列表，每个结果为字典，至少包含:
            - id: 向量ID
            - content: 向量对应的内容
            - metadata: 向量的元数据
            - score: 相似度分数
        """
        pass
    
    @abstractmethod
    def delete_collection(
        self,
        collection_name: str,
        **kwargs
    ) -> bool:
        """
        删除数据库中的集合
        
        Args:
            collection_name: 集合名称
            **kwargs: 特定实现可能需要的额外参数
            
        Returns:
            操作是否成功
        """
        pass

