"""
PuppyModel - 统一模型接口

这个包提供了一个统一的接口来使用不同提供商的模型，包括:
- OpenAI的模型
- HuggingFace的模型
- Ollama的本地模型

主要功能:
- 模型能力检测和管理
- 文本生成 (LLM)
- 文本嵌入向量生成 (Embedding)
"""

from puppy_model.capabilities import ModelCapability
from puppy_model.registry import ModelRegistry
from puppy_model.embedding import Embedder
from puppy_model.llm import LLM
from puppy_model.main import (
    get_manager,
    list_providers,
    list_models,
    list_llm_models,
    list_embedding_models,
    embed,
    generate
)

__all__ = [
    # 能力枚举
    'ModelCapability',
    
    # 模型类
    'Embedder',
    'LLM',
    'ModelRegistry',
    
    # 主要API
    'get_manager',
    'list_providers',
    'list_models',
    'list_llm_models',
    'list_embedding_models',
    'embed',
    'generate',
]
