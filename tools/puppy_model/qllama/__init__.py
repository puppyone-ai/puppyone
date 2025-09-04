"""
qllama包 - 统一LLM和嵌入模型接口

支持多种模型提供商，包括：
- OpenAI (GPT系列、text-embedding系列)
- HuggingFace (transformers模型)
- Ollama (本地模型)
- OpenRouter (多模型路由)

使用示例：
    from qllama import LLM, Embedder
    
    llm = LLM("gpt-3.5-turbo")
    response = llm.generate("Hello, world!")
"""

from qllama.capabilities import ModelCapability
from qllama.registry import ModelRegistry
from qllama.embedding import Embedder
from qllama.llm import LLM
from qllama.main import (
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
