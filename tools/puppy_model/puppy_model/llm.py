from typing import List, Optional, Dict
from .registry import ModelRegistry
from .capabilities import ModelCapability

class LLM:
    """简化的LLM接口"""
    
    def __init__(self, model_name: str, provider_name: Optional[str] = None, **kwargs):
        self.registry = ModelRegistry()
        self.model_name = model_name
        
        # 自动查找提供商
        if not provider_name:
            provider_name = self._find_provider_for_model(model_name)
        
        self.provider = self.registry.get_provider(provider_name, **kwargs)
        
        # 验证能力
        capabilities = self.provider.get_capabilities(model_name)
        if not (capabilities & ModelCapability.LLM):
            raise ValueError(f"Model {model_name} does not support LLM capabilities")
    
    def _find_provider_for_model(self, model_name: str) -> str:
        """查找支持此模型的提供商"""
        for provider_name in self.registry.list_providers():
            provider = self.registry.get_provider(provider_name)
            all_models = provider.__class__.list_models()
            if model_name in all_models:
                return provider_name
        raise ValueError(f"No provider found for model {model_name}")
    
    def generate(self, prompt: str, **kwargs) -> str:
        """生成文本"""
        return self.provider.generate(self.model_name, prompt, **kwargs)
    
    @classmethod
    def list_models(cls) -> Dict[str, List[str]]:
        """列出所有支持LLM的模型"""
        return ModelRegistry().list_models_by_capability(ModelCapability.LLM) 