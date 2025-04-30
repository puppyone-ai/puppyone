"""
PuppyStorage Vector Embedder Module
-----------------------------------

Core Features (MVP):
- Abstract base class for embedding models with provider-agnostic interface
- Model registry system with automatic provider registration
- Factory method pattern for elegant model instantiation
- Multi-provider support: HuggingFace, SentenceTransformer, OpenAI, and Ollama
- Simple model discovery mechanism for local providers
- Unified embedding API across all providers
- Basic model metadata and capabilities

Implementation Phases:
1. Core Registry & Factory (MVP)
   - Basic model registry structure
   - Provider interface definition
   - Static model mapping
   - Simple factory methods

2. Ollama Integration (MVP)
   - HTTP API client for Ollama
   - Model list discovery
   - Embedding generation implementation
   - Basic endpoint configuration

3. Enhanced Selection (Future)
   - Feature-based model selection
   - Prioritization rules for identical models
   - User preference persistence
   - Front-end model selection UI

4. Advanced Features (Future)
   - Comprehensive error handling
   - Performance optimizations and caching strategies
   - Health monitoring and metrics
   - Dynamic scaling and load balancing

Model Registry Design:
- Centralized singleton registry for model-to-provider mapping
- Simple provider interface for consistent implementation
- Straightforward registration mechanism via decorators or direct calls
- Support for both static and dynamic model discovery

Usage example:
    # Simple usage with automatic provider selection
    embedder = TextEmbedder.create("llama3")
    vectors = embedder.embed(["document1", "document2"])
    
    # Specify provider explicitly when needed
    embedder = TextEmbedder.create("text-embedding-3-small", provider="openai")
    vectors = embedder.embed(["document1", "document2"])
        
    # Configure endpoint for local providers
    embedder = TextEmbedder.create("llama3", endpoint="http://localhost:11434")
    vectors = embedder.embed(["document1", "document2"])

Core Implementation (simplified):
```python
class ModelRegistry:
    _instance = None
    _providers = {}
    _models = {}
    
    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance
    
    def register_provider(self, name, provider_class):
        self._providers[name] = provider_class
        
    def register_model(self, model_name, provider_name):
        self._models[model_name] = provider_name
        
    def get_provider_for_model(self, model_name, preferred_provider=None):
        if preferred_provider and model_name in self._models.get(preferred_provider, []):
            return self._providers[preferred_provider]
        return self._providers[self._models.get(model_name)]
```
"""

# If you are a VS Code users:
import os
import sys
from typing import List, Union, Dict, Any, Optional, Type
from io import BytesIO
from PIL import Image
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from abc import ABC, abstractmethod

from openai import OpenAI
from transformers import AutoTokenizer, AutoModel
from sentence_transformers import SentenceTransformer
from torch import no_grad, Tensor, tensor, mean, matmul
from utils.puppy_exception import PuppyException, global_exception_handler
from utils.config import config
import threading
import re
import requests


class ModelRegistry:
    """
    Singleton registry for embedding models and providers.
    Manages the mapping between model names and their providers.
    """
    _instance = None
    _lock = threading.Lock()
    _providers = {}  # 存储提供商类: {"openai": OpenAIProvider, "huggingface": HuggingFaceProvider}
    _models = {}     # 存储模型到提供商的映射: {"text-embedding-ada-002": "openai", "BAAI/bge-m3": "huggingface"}
    _available_providers = set()  # 当前环境下可用的提供商
    
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
        # 初始化将在注册提供商时完成
    
    @classmethod
    def register_provider(cls, name: str, provider_class: Type['ProviderInterface']):
        """注册提供商类"""
        with cls._lock:
            cls._providers[name] = provider_class
            # 注册时默认可用，后续会基于环境检测调整
            cls._available_providers.add(name)
    
    @classmethod
    def register_models(cls, provider_name: str, models: List[str]):
        """批量注册模型到提供商的映射"""
        with cls._lock:
            for model in models:
                cls._models[model] = provider_name
    
    @classmethod
    def get_provider_class(cls, provider_name: str) -> Type['ProviderInterface']:
        """获取提供商类"""
        if provider_name not in cls._providers:
            raise PuppyException(3300, f"Provider {provider_name} not registered", 
                                "The embedding provider you requested is not available.")
        return cls._providers[provider_name]
    
    @classmethod
    def check_environment(cls):
        """检查当前环境并标记可用的提供商"""
        with cls._lock:
            # 重置可用提供商
            cls._available_providers = set(cls._providers.keys())
            
            # 检查是否为本地部署环境
            is_local_deployment = config.get("DEPLOYMENT_TYPE") == "local"
            
            # 如果是本地部署，检查各提供商的可用性
            if is_local_deployment:
                # OpenAI通常在本地部署中不可用，除非显式配置
                if not config.get("OPENAI_API_KEY"):
                    cls._available_providers.discard("openai")
                
                # HuggingFace和SentenceTransformer是本地模型，默认可用
                
                # Ollama需要检查本地服务是否可用
                try:
                    endpoint = config.get("OLLAMA_API_ENDPOINT") or "http://localhost:11434"
                    response = requests.get(f"{endpoint}/api/tags", timeout=2)
                    if response.status_code != 200:
                        cls._available_providers.discard("ollama")
                except:
                    cls._available_providers.discard("ollama")
    
    @classmethod
    def get_provider_for_model(cls, model_name: str, preferred_provider: Optional[str] = None) -> str:
        """获取模型对应的提供商名称"""
        # 首先检查环境
        if not cls._available_providers:
            cls.check_environment()
            
        # 如果指定了提供商，检查其是否可用
        if preferred_provider:
            if preferred_provider in cls._providers and preferred_provider in cls._available_providers:
                return preferred_provider
            elif preferred_provider in cls._providers and preferred_provider not in cls._available_providers:
                raise PuppyException(3305, f"Provider {preferred_provider} not available in current environment", 
                                  f"The provider {preferred_provider} is not available in your current deployment environment.")
            
        # 查找模型对应的默认提供商
        if model_name not in cls._models:
            raise PuppyException(3301, f"Model {model_name} not found", 
                                "The embedding model you requested is not available.")
        
        provider_name = cls._models[model_name]
        
        # 检查提供商在当前环境是否可用
        if provider_name not in cls._available_providers:
            # 尝试查找替代提供商
            alternative_providers = [p for p in cls._available_providers if p in cls._providers]
            if not alternative_providers:
                raise PuppyException(3306, "No available providers", 
                                   "There are no embedding providers available in your current environment.")
                
            # 优先选择本地提供商
            local_providers = ["huggingface", "sentencetransformers", "ollama"]
            for p in local_providers:
                if p in alternative_providers:
                    return p
                    
            # 如果没有本地提供商，返回第一个可用的
            return alternative_providers[0]
            
        return provider_name
    
    @classmethod
    def list_models(cls, provider_name: Optional[str] = None) -> List[str]:
        """列出所有模型或特定提供商的模型"""
        # 首先检查环境
        if not cls._available_providers:
            cls.check_environment()
            
        if provider_name:
            if provider_name not in cls._available_providers:
                return []
            return [model for model, provider in cls._models.items() if provider == provider_name]
        
        # 只返回可用提供商的模型
        return [model for model, provider in cls._models.items() if provider in cls._available_providers]
        
    @classmethod
    def list_available_providers(cls) -> List[str]:
        """列出当前环境下可用的提供商"""
        if not cls._available_providers:
            cls.check_environment()
        return list(cls._available_providers)


class ProviderInterface(ABC):
    """
    Interface for embedding model providers.
    Each provider must implement the required methods.
    """
    
    @abstractmethod
    def __init__(self, model_name: str, **kwargs):
        """初始化提供商"""
        pass
    
    @abstractmethod
    def embed(self, docs: List[str]) -> List[List[float]]:
        """生成文档的嵌入向量"""
        pass
        
    @classmethod
    @abstractmethod
    def get_supported_models(cls) -> List[str]:
        """获取提供商支持的模型列表"""
        pass


class Embedder(ABC):
    """
    Base class for embedding models.
    """

    @abstractmethod
    def embed(
        self,
        docs: List[str]
    ) -> List[List[float]]:
        pass


class OpenAIProvider(ProviderInterface):
    """OpenAI embedding provider implementation"""
    
    def __init__(self, model_name: str, **kwargs):
        self.model_name = model_name
        self.api_key = kwargs.get("api_key") or config.get("OPENAI_API_KEY")
        
        if not self.api_key:
            raise PuppyException(3301, "Missing OpenAI API Key", 
                                "API key is required for OpenAI Embedding!")
                                
        self.client = OpenAI(api_key=self.api_key)
    
    def embed(self, docs: List[str]) -> List[List[float]]:
        response = self.client.embeddings.create(
            input=docs,
            model=self.model_name
        ).data
        return [item.embedding for item in response]
    
    @classmethod
    def get_supported_models(cls) -> List[str]:
        return [
            "text-embedding-ada-002",
            "text-embedding-3-small",
            "text-embedding-3-large",
        ]


class HuggingFaceProvider(ProviderInterface):
    """HuggingFace embedding provider implementation"""
    
    _model_cache = {}  # 类级别的模型缓存
    _lock = threading.Lock()
    
    def __init__(self, model_name: str, **kwargs):
        self.model_name = model_name
        
        with self._lock:
            cache_key = model_name
            if cache_key in self._model_cache:
                self.model, self.tokenizer = self._model_cache[cache_key]
            else:
                self.model = AutoModel.from_pretrained(model_name)
                self.tokenizer = AutoTokenizer.from_pretrained(model_name)
                self._model_cache[cache_key] = (self.model, self.tokenizer)
    
    def embed(self, docs: List[str]) -> List[List[float]]:
        inputs = self.tokenizer(docs, padding=True, truncation=True, return_tensors="pt")
        with no_grad():
            outputs = self.model(**inputs)
        return mean(outputs.last_hidden_state, dim=1).tolist()
    
    @classmethod
    def get_supported_models(cls) -> List[str]:
        return [
            "BAAI/bge-m3",
            "BAAI/llm-embedder",
            "BAAI/bge-large-en-v1.5",
            "BAAI/bge-base-en-v1.5",
            "BAAI/bge-small-en-v1.5",
            "BAAI/bge-large-zh-v1.5",
            "BAAI/bge-base-zh-v1.5",
            "BAAI/bge-small-zh-v1.5",
            "DMetaSoul/Dmeta-embedding-zh",
            "shibing624/text2vec-base-chinese",
            "sentence-transformers/sentence-t5-large",
            "sentence-transformers/mpnet",
            "jinaai/jina-colbert-v2",
            "jinaai/jina-embeddings-v3",
            "jinaai/jina-embeddings-v2-base-zh",
            "openbmb/MiniCPM-Embedding",
            "maidalun1020/bce-embedding-base_v1"
        ]


class SentenceTransformerProvider(ProviderInterface):
    """SentenceTransformer embedding provider implementation"""
    
    _model_cache = {}  # 类级别的模型缓存
    _lock = threading.Lock()
    
    def __init__(self, model_name: str, **kwargs):
        self.model_name = model_name
        
        with self._lock:
            if model_name in self._model_cache:
                self.model = self._model_cache[model_name]
            else:
                self.model = SentenceTransformer(model_name)
                self._model_cache[model_name] = self.model
    
    def embed(self, docs: List[str]) -> List[List[float]]:
        return self.model.encode(docs, convert_to_tensor=True).tolist()
    
    @classmethod
    def get_supported_models(cls) -> List[str]:
        return [
            "paraphrase-multilingual-mpnet-base-v2",
            "paraphrase-multilingual-MiniLM-L12-v2",
            "paraphrase-albert-small-v2",
            "paraphrase-MiniLM-L3-v2",
            "multi-qa-mpnet-base-dot-v1",
            "multi-qa-distilbert-cos-v1",
            "multi-qa-MiniLM-L6-cos-v1",
            "distiluse-base-multilingual-cased-v2",
            "distiluse-base-multilingual-cased-v1",
            "all-mpnet-base-v2",
            "all-distilroberta-v1",
            "all-MiniLM-L6-v2",
            "all-MiniLM-L12-v2",
        ]


class OllamaProvider(ProviderInterface):
    """Ollama embedding provider implementation"""
    
    def __init__(self, model_name: str, **kwargs):
        self.model_name = model_name
        # 优先从kwargs获取，其次从环境变量，最后使用默认值
        self.endpoint = kwargs.get("endpoint") or os.environ.get("OLLAMA_API_ENDPOINT") or "http://localhost:11434"
        # 确保endpoint没有尾随斜杠
        self.endpoint = self.endpoint.rstrip("/")
        
        # 检查Ollama服务是否可用
        try:
            response = requests.get(f"{self.endpoint}/api/tags", timeout=5)
            response.raise_for_status()
        except (requests.RequestException, IOError) as e:
            raise PuppyException(3302, "Ollama Service Unavailable", 
                                f"Could not connect to Ollama at {self.endpoint}: {str(e)}")
    
    def embed(self, docs: List[str]) -> List[List[float]]:
        results = []
        for doc in docs:
            try:
                response = requests.post(
                    f"{self.endpoint}/api/embed",
                    json={"model": self.model_name, "input": doc},
                    timeout=30
                )
                response.raise_for_status()
                data = response.json()
                results.append(data["embeddings"])
            except (requests.RequestException, IOError, KeyError, ValueError) as e:
                raise PuppyException(3303, "Ollama Embedding Failed", 
                                    f"Failed to get embeddings from Ollama: {str(e)}")
        return results
    
    @classmethod
    def get_supported_models(cls, endpoint: str = "http://localhost:11434") -> List[str]:
        """
        动态获取Ollama支持的模型列表
        实际应用中可能需要缓存，这里简化实现
        """
        try:
            response = requests.get(f"{endpoint.rstrip('/')}/api/tags", timeout=5)
            response.raise_for_status()
            data = response.json()
            return [model["name"] for model in data["models"]]
        except:
            # 如果无法连接到Ollama，返回空列表
            return []


class TextEmbedder(Embedder):
    """
    Unified text embedding class supporting multiple providers through a factory pattern.
    """
    
    def __init__(self, provider_instance: ProviderInterface):
        """
        私有初始化方法，应通过create工厂方法创建实例
        """
        self._provider = provider_instance
        self._preprocess_enabled = True

    @classmethod
    def create(cls, model_name: str, **kwargs) -> 'TextEmbedder':
        """
        Factory method to create TextEmbedder instance.
        
        Args:
            model_name (str): Name of the model to use
            **kwargs: Additional arguments for the provider
                - provider (str, optional): Force a specific provider
                - api_key (str, optional): API key for services that require it
                - endpoint (str, optional): Endpoint URL for local services like Ollama
                
        Returns:
            TextEmbedder: An instance configured with the specified model
        """
        # 确定提供商
        preferred_provider = kwargs.pop("provider", None)
        provider_name = ModelRegistry.get_provider_for_model(model_name, preferred_provider)
        
        # 获取提供商类并实例化
        provider_class = ModelRegistry.get_provider_class(provider_name)
        provider_instance = provider_class(model_name, **kwargs)
        
        # 创建并返回TextEmbedder实例
        return cls(provider_instance)
    
    def disable_preprocessing(self):
        """禁用文本预处理"""
        self._preprocess_enabled = False
        return self
        
    def enable_preprocessing(self):
        """启用文本预处理"""
        self._preprocess_enabled = True
        return self
    
    def _is_natural_language(self, text: str) -> bool:
        """检查是否为自然语言文本"""
        # 检查文本是否包含足够的单词/字符比例
        words = re.findall(r'\b\w+\b|[\u4e00-\u9fff]', text)
        if not words:
            return False
        # 检查随机字符串的特征
        random_looking = re.match(r'^[A-Za-z0-9]{4,8}$', text) is not None
        return not random_looking

    def _preprocess_content(self, content: str) -> str:
        """预处理内容为适合嵌入的格式"""
        if not isinstance(content, str):
            content = str(content)
        
        if not self._preprocess_enabled:
            return content
            
        # 如果看起来不像自然语言，尝试从metadata中获取描述
        if not self._is_natural_language(content):
            return f"Token identifier: {content}"
        
        return content.strip()

    @global_exception_handler(3201, "Error Generating Embeddings")
    def embed(
        self,
        docs: List[str]
    ) -> List[List[float]]:
        """
        Generates embeddings for the input documents.

        Args:
            docs (List[str]): List of input documents.

        Returns:
            List[List[float]]: List of embedding vectors.
        """
        # 预处理所有文档
        processed_docs = [self._preprocess_content(doc) for doc in docs]
        
        # 使用提供商生成嵌入
        return self._provider.embed(processed_docs)


# 注册提供商
ModelRegistry.register_provider("openai", OpenAIProvider)
ModelRegistry.register_provider("huggingface", HuggingFaceProvider)
ModelRegistry.register_provider("sentencetransformers", SentenceTransformerProvider)
ModelRegistry.register_provider("ollama", OllamaProvider)

# 注册模型
ModelRegistry.register_models("openai", OpenAIProvider.get_supported_models())
ModelRegistry.register_models("huggingface", HuggingFaceProvider.get_supported_models())
ModelRegistry.register_models("sentencetransformers", SentenceTransformerProvider.get_supported_models())

# 如果Ollama可用，尝试注册其模型
try:
    ollama_models = OllamaProvider.get_supported_models()
    if ollama_models:
        ModelRegistry.register_models("ollama", ollama_models)
except:
    # 如果Ollama不可用，忽略错误
    pass


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    
    docs = ["Puppy Happy"]

    # # 使用工厂方法创建实例
    # try:
    #     embedder = TextEmbedder.create("text-embedding-ada-002")
    #     print(embedder.embed(docs))
    # except Exception as e:
    #     print(f"OpenAI测试失败: {str(e)}")

    # try:
    #     embedder = TextEmbedder.create("BAAI/bge-small-zh-v1.5")
    #     print(embedder.embed(docs))
    # except Exception as e:
    #     print(f"HuggingFace测试失败: {str(e)}")

    # try:
    #     embedder = TextEmbedder.create("all-MiniLM-L6-v2")
    #     print(embedder.embed(docs))
    # except Exception as e:
    #     print(f"SentenceTransformer测试失败: {str(e)}")
        
    try:
        # Ollama通常需要本地运行的服务
        model_list = OllamaProvider.get_supported_models()
        print(model_list)

        embedder = TextEmbedder.create("bge-large:latest", endpoint="http://localhost:11434")
        print(embedder.embed(docs))
    except Exception as e:
        print(f"Ollama测试失败: {str(e)}")
