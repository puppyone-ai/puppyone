import requests
from typing import List, Dict, Any, Optional
import sys
import os

# 添加父级目录到路径以解决导入问题
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from puppy_model.capabilities import ModelCapability, cached
from puppy_model.providers.base import Provider

class OllamaProvider(Provider):
    """Ollama提供商实现"""
    
    def __init__(self, endpoint: str = "http://localhost:11434"):
        self.endpoint = endpoint.rstrip("/")
    
    @classmethod
    def list_models(cls, endpoint: str = "http://localhost:11434") -> List[str]:
        """获取模型列表"""
        try:
            response = requests.get(f"{endpoint.rstrip('/')}/api/tags", timeout=5)
            if response.status_code != 200:
                return []
            
            data = response.json()
            return [model["name"] for model in data.get("models", [])]
        except Exception as e:
            print(f"Error listing Ollama models: {e}")
            return []
    
    @cached
    def get_capabilities(self, model_name: str) -> ModelCapability:
        """获取模型能力"""
        capabilities = ModelCapability.NONE
        
        # 检测LLM能力 - 用更可靠的方式检查，增加超时时间
        try:
            response = requests.post(
                f"{self.endpoint}/api/generate",
                json={"model": model_name, "prompt": "hello", "stream": False},
                timeout=10  # 增加超时时间
            )
            if response.status_code == 200:
                capabilities |= ModelCapability.LLM
                print(f"Model {model_name} supports LLM")
        except Exception as e:
            print(f"LLM capability check failed for {model_name}: {e}")
        
        # 检测嵌入能力 - 增加超时时间
        try:
            response = requests.post(
                f"{self.endpoint}/api/embed",
                json={"model": model_name, "input": "hello"},
                timeout=10  # 增加超时时间
            )
            if response.status_code == 200:
                capabilities |= ModelCapability.EMBEDDING
                print(f"Model {model_name} supports EMBEDDING")
        except Exception as e:
            print(f"EMBEDDING capability check failed for {model_name}: {e}")
        
        return capabilities
    
    def embed(self, model_name: str, texts: List[str], **kwargs) -> List[List[float]]:
        """生成嵌入向量"""
        results = []
        for text in texts:
            response = requests.post(
                f"{self.endpoint}/api/embed",
                json={"model": model_name, "input": text},
                timeout=kwargs.get("timeout", 30)
            )
            
            if response.status_code != 200:
                raise Exception(f"Ollama embedding failed: {response.text}")
            
            data = response.json()
            results.append(data["embeddings"])
        
        return results
    
    def generate(self, model_name: str, prompt: str, **kwargs) -> str:
        """生成文本"""
        stream = kwargs.pop("stream", False)
        if stream:
            # 流式实现略，根据需要补充
            raise NotImplementedError("Streaming not implemented")
        
        response = requests.post(
            f"{self.endpoint}/api/generate",
            json={"model": model_name, "prompt": prompt, **kwargs},
            timeout=kwargs.get("timeout", 60)
        )
        
        if response.status_code != 200:
            raise Exception(f"Ollama generation failed: {response.text}")
        
        data = response.json()
        return data["response"] 