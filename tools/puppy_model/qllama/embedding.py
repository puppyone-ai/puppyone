from typing import List, Optional, Dict
from .capabilities import ModelCapability

class Embedder:
    """简化的嵌入接口"""
    
    def __init__(self, model_name: str, provider_name: Optional[str] = None, **kwargs):
        # 使用全局管理器而不是创建新的注册表
        from .main import get_manager
        self.manager = get_manager()
        self.model_name = model_name
        
        # 自动查找提供商
        if not provider_name:
            provider_name = self._find_provider_for_model(model_name)
        
        self.provider = self.manager.get_provider(provider_name, **kwargs)
        
        # 验证能力
        capabilities = self.provider.get_capabilities(model_name)
        if not (capabilities & ModelCapability.EMBEDDING):
            raise ValueError(f"Model {model_name} does not support embedding")
    
    def _find_provider_for_model(self, model_name: str) -> str:
        """查找支持此模型的提供商"""
        for provider_name in self.manager.list_providers():
            provider = self.manager.get_provider(provider_name)
            all_models = provider.__class__.list_models()
            if model_name in all_models:
                return provider_name
        raise ValueError(f"No provider found for model {model_name}")
    
    def embed(self, texts: List[str], **kwargs) -> List[List[float]]:
        """生成嵌入向量"""
        return self.provider.embed(self.model_name, texts, **kwargs)
    
    @classmethod
    def list_models(cls) -> Dict[str, List[str]]:
        """列出所有支持嵌入的模型"""
        from .main import get_manager
        return get_manager().list_models_by_capability(ModelCapability.EMBEDDING) 