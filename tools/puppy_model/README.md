# PuppyModel

统一的模型管理包，同时支持嵌入和LLM功能。

## 功能特点

- 统一接口：所有提供商通过相同的接口提供服务
- 自动能力检测：自动检测模型支持的功能（嵌入、LLM等）
- 多提供商支持：支持Ollama、OpenAI、HuggingFace等
- 简单易用的API：面向任务的简洁API

## 安装

```bash
pip install -e /path/to/puppy_model
```

## 使用示例

### 基本用法

```python
from puppy_model import Embedder, LLM

# 嵌入示例
embedder = Embedder("bge-large:latest", provider_name="ollama")
vectors = embedder.embed(["文档1", "文档2"])

# LLM示例
llm = LLM("llama3.2:latest", provider_name="ollama")
response = llm.generate("讲个笑话")
print(response)
```

### 获取可用模型

```python
from puppy_model import Embedder, LLM, ModelRegistry

# 获取所有提供商
registry = ModelRegistry()
providers = registry.list_providers()
print(f"可用提供商: {providers}")

# 获取支持嵌入的模型
embed_models = Embedder.list_models()
print(f"支持嵌入的模型: {embed_models}")

# 获取支持LLM的模型
llm_models = LLM.list_models()
print(f"支持LLM的模型: {llm_models}")
```

## 自定义配置

```python
# Ollama配置
embedder = Embedder("bge-large:latest", provider_name="ollama", endpoint="http://localhost:11434")

# 设置超时时间
vectors = embedder.embed(["文档1", "文档2"], timeout=60)
```

## 集成到现有项目

```python
# 示例：在FastAPI中添加模型API
from fastapi import APIRouter
from puppy_model import Embedder, LLM

router = APIRouter()

@router.get("/models/embed")
async def get_embedding_models():
    """获取支持嵌入的模型列表"""
    return {"models": Embedder.list_models()}

@router.get("/models/llm")
async def get_llm_models():
    """获取支持LLM的模型列表"""
    return {"models": LLM.list_models()}
``` 