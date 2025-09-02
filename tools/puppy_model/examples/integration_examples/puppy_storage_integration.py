"""
PuppyStorage集成示例 - 展示如何将qllama集成到PuppyStorage
"""
import os
import sys

# 确保能够导入qllama包
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from qllama import Embedder, ModelCapability

class PuppyStorageEmbedding:
    """
    兼容原始API的嵌入类，内部使用qllama
    """
    
    def __init__(self, provider_instance=None):
        """
        私有初始化方法，应通过create工厂方法创建实例
        """
        self._provider = provider_instance
        self._preprocess_enabled = True

    @classmethod
    def create(cls, model_name: str, **kwargs) -> 'PuppyStorageEmbedding':
        """
        Factory method to create PuppyStorageEmbedding instance.
        
        Args:
            model_name (str): Name of the model to use
            **kwargs: Additional arguments for the provider
                - provider (str, optional): Force a specific provider
                - api_key (str, optional): API key for services that require it
                - endpoint (str, optional): Endpoint URL for local services like Ollama
                
        Returns:
            PuppyStorageEmbedding: An instance configured with the specified model
        """
        try:
            # 使用qllama创建嵌入器
            provider_name = kwargs.pop("provider", None)
            embedder = Embedder(model_name, provider_name, **kwargs)
            
            # 创建并返回PuppyStorageEmbedding实例
            return cls(embedder)
        except Exception as e:
            # 转换异常为PuppyException（示例中简化为普通异常）
            raise Exception(f"Model initialization error: {str(e)}")
    
    def disable_preprocessing(self):
        """禁用文本预处理"""
        self._preprocess_enabled = False
        return self
        
    def enable_preprocessing(self):
        """启用文本预处理"""
        self._preprocess_enabled = True
        return self
    
    def _preprocess_content(self, content: str) -> str:
        """预处理内容为适合嵌入的格式"""
        if not isinstance(content, str):
            content = str(content)
        
        if not self._preprocess_enabled:
            return content
            
        # 简化的预处理
        return content.strip()

    def embed(self, docs: list) -> list:
        """
        Generates embeddings for the input documents.

        Args:
            docs (List[str]): List of input documents.

        Returns:
            List[List[float]]: List of embedding vectors.
        """
        # 预处理所有文档
        processed_docs = [self._preprocess_content(doc) for doc in docs]
        
        # 使用qllama生成嵌入
        try:
            return self._provider.embed(processed_docs)
        except Exception as e:
            # 转换为PuppyException（示例中简化为普通异常）
            raise Exception(f"Embedding generation failed: {str(e)}")


# 提供静态方法以兼容现有代码
def list_embedding_models():
    """列出所有支持嵌入的模型"""
    try:
        return Embedder.list_models()
    except Exception as e:
        print(f"Error listing embedding models: {e}")
        return {}


# FastAPI路由示例
def create_fastapi_routes():
    """
    示例：如何在FastAPI中添加模型API
    """
    from fastapi import APIRouter
    
    router = APIRouter()
    
    @router.get("/models/embed")
    async def get_embedding_models():
        """获取支持嵌入的模型列表"""
        models = list_embedding_models()
        # 扁平化结果为前端友好格式
        result = []
        for provider, model_list in models.items():
            for model in model_list:
                result.append({
                    "name": model,
                    "provider": provider
                })
        return {"models": result}
    
    return router


if __name__ == "__main__":
    # 测试集成
    print("=== 测试PuppyStorage集成 ===")
    
    # 测试列出模型
    models = list_embedding_models()
    print("可用嵌入模型:")
    for provider, model_list in models.items():
        print(f"  - {provider}: {len(model_list)} 个模型")
        if model_list:
            print(f"    - 示例: {model_list[0]}")
    
    # 测试嵌入功能
    if any(models.values()):
        provider = next((p for p, m in models.items() if m), None)
        if provider:
            model = models[provider][0]
            try:
                print(f"\n使用模型 {model} (提供商: {provider})")
                embedder = PuppyStorageEmbedding.create(model, provider=provider)
                vectors = embedder.embed(["测试文档1", "测试文档2"])
                print(f"嵌入成功:")
                print(f"- 文档数量: {len(vectors)}")
                print(f"- 嵌入维度: {len(vectors[0])}")
                print(f"- 前几维示例: {vectors[0][:5]}")
            except Exception as e:
                print(f"嵌入测试失败: {e}")
    else:
        print("没有找到可用的嵌入模型") 