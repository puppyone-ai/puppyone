from typing import Dict, List, Type, Set, Optional, Any
import threading
from .capabilities import ModelCapability
from .providers.base import Provider

class ModelRegistry:
    """简化的模型注册表"""
    _instance = None
    _lock = threading.Lock()
    _providers = {}  # 名称到提供商类的映射
    
    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(ModelRegistry, cls).__new__(cls)
                cls._instance._initialized = False
            return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        # 提供商实例缓存
        self._provider_instances = {}
    
    @classmethod
    def register(cls, name: str, provider_class: Type[Provider]):
        """注册提供商"""
        with cls._lock:
            cls._providers[name] = provider_class
    
    def get_provider(self, name: str, **kwargs) -> Provider:
        """获取提供商实例"""
        if name not in self._providers:
            raise ValueError(f"Provider {name} not registered")
        
        # 简单的提供商实例缓存策略
        cache_key = name + str(sorted(kwargs.items()))
        if cache_key not in self._provider_instances:
            self._provider_instances[cache_key] = self._providers[name](**kwargs)
        
        return self._provider_instances[cache_key]
    
    def list_providers(self) -> List[str]:
        """获取所有注册的提供商"""
        return list(self._providers.keys())
    
    def list_all_models(self) -> Dict[str, List[str]]:
        """获取所有可用模型"""
        results = {}
        for provider_name, provider_class in self._providers.items():
            try:
                results[provider_name] = provider_class.list_models()
            except Exception as e:
                print(f"Error listing models for {provider_name}: {e}")
                results[provider_name] = []
        return results
    
    def list_models_by_capability(self, capability: ModelCapability) -> Dict[str, List[str]]:
        """获取具有特定能力的模型"""
        results = {}
        for provider_name, provider_class in self._providers.items():
            try:
                provider = self.get_provider(provider_name)
                all_models = provider_class.list_models()
                capable_models = [
                    model for model in all_models
                    if capability & provider.get_capabilities(model)
                ]
                results[provider_name] = capable_models
            except Exception as e:
                print(f"Error listing models for {provider_name}: {e}")
                results[provider_name] = []
        return results 