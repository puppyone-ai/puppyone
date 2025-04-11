# If you are a VS Code users:
import os
import sys
from typing import List, Union, Dict, Any
from io import BytesIO
from PIL import Image
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from abc import ABC, abstractmethod

from openai import OpenAI
from transformers import AutoTokenizer, AutoModel
from sentence_transformers import SentenceTransformer
from torch import no_grad, Tensor, tensor, mean, matmul
from utils.puppy_exception import PuppyException, global_exception_handler
from utils.config import config
import threading
import re


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


class TextEmbedder(Embedder):
    """
    Unified text embedding class supporting HuggingFace, SentenceTransformer, and OpenAI.
    """

    _model_cache = {}  # 模型缓存池 {model_name: (model, tokenizer, client)}
    _lock = threading.Lock()  # 线程安全锁

    # TODO: 
    # 需要优化缓存机制:
    # 添加缓存过期机制（LRU策略）
    # 实现基于内存压力的自动卸载

    def __init__(
        self,
        model_name: str,
        api_key: Union[str, None] = None
    ):
        """
        Initializes the TextEmbedding instance based on the provider.

        Args:
            provider (str): The embedding model provider ('huggingface', 'sentencetransformers', or 'openai').
            model_name (str): The name of the model to use.
            api_key (Union[str, None]): API key, required only for OpenAI.
        """

        self.model_name = model_name
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        self.model_provider_dict = {
            "paraphrase-multilingual-mpnet-base-v2": "sentencetransformers",
            "paraphrase-multilingual-MiniLM-L12-v2": "sentencetransformers",
            "paraphrase-albert-small-v2": "sentencetransformers",
            "paraphrase-MiniLM-L3-v2": "sentencetransformers",
            "multi-qa-mpnet-base-dot-v1": "sentencetransformers",
            "multi-qa-distilbert-cos-v1": "sentencetransformers",
            "multi-qa-MiniLM-L6-cos-v1": "sentencetransformers",
            "distiluse-base-multilingual-cased-v2": "sentencetransformers",
            "distiluse-base-multilingual-cased-v1": "sentencetransformers",
            "all-mpnet-base-v2": "sentencetransformers",
            "all-distilroberta-v1": "sentencetransformers",
            "all-MiniLM-L6-v2": "sentencetransformers",
            "all-MiniLM-L12-v2": "sentencetransformers",
            "BAAI/bge-m3": "huggingface",
            "BAAI/llm-embedder": "huggingface",
            "BAAI/bge-large-en-v1.5": "huggingface",
            "BAAI/bge-base-en-v1.5": "huggingface",
            "BAAI/bge-small-en-v1.5": "huggingface",
            "BAAI/bge-large-zh-v1.5": "huggingface",
            "BAAI/bge-base-zh-v1.5": "huggingface",
            "BAAI/bge-small-zh-v1.5": "huggingface",
            "DMetaSoul/Dmeta-embedding-zh": "huggingface",
            "shibing624/text2vec-base-chinese": "huggingface",
            "sentence-transformers/sentence-t5-large": "huggingface",
            "sentence-transformers/mpnet": "huggingface",
            "jinaai/jina-colbert-v2": "huggingface",
            "jinaai/jina-embeddings-v3": "huggingface",
            "jinaai/jina-embeddings-v2-base-zh": "huggingface",
            "openbmb/MiniCPM-Embedding": "huggingface",
            "maidalun1020/bce-embedding-base_v1": "huggingface",
            "text-embedding-ada-002": "openai",
            "text-embedding-3-small": "openai",
            "text-embedding-3-large": "openai",
        }
        self._provider = self.model_provider_dict.get(model_name, "openai")
        self._initialize_model()

    def __enter__(self):
        """支持上下文管理器"""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """支持上下文管理器"""
        # 无需特殊清理
        pass

    # TODO: Add a mechanism to prevent resource uncompelted by downloading intereption
    @global_exception_handler(3200, "Error Initializing Embedding Model")
    def _initialize_model(self):
        with self._lock:  # 保证线程安全
            if self.model_name in self._model_cache:
                # 直接从缓存获取
                cached_data = self._model_cache[self.model_name]
                self._model = cached_data[0]
                self._tokenizer = cached_data[1]
                self._client = cached_data[2]
                return

            # 初始化默认值
            self._model = None
            self._tokenizer = None
            self._client = None

            if self._provider == "huggingface":
                self._model = AutoModel.from_pretrained(self.model_name)
                self._tokenizer = AutoTokenizer.from_pretrained(self.model_name)
            elif self._provider == "sentencetransformers":
                self._model = SentenceTransformer(self.model_name)
            elif self._provider == "openai":
                if not self.api_key:
                    raise PuppyException(3301, "Missing Embedding Model API Key", "API key is required for OpenAI Embedding!")
                self._client = OpenAI(api_key=self.api_key)
            else:
                raise PuppyException(3300, "Unsupported Embedding Model Provider", f"Embedder provider {self._provider} is unsupported!")

            # 将新模型存入缓存
            self._model_cache[self.model_name] = (self._model, self._tokenizer, self._client)

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

        输出结构示例
        vectors = [
            [0.12, -0.45, 0.78, ...],  # 第一个文档的嵌入向量（长度=模型维度）
            [0.34, 0.21, -0.09, ...],  # 第二个文档的嵌入向量
            ... 后续文档的嵌入
        ]
        """

        # 预处理所有文档
        processed_docs = [self._preprocess_content(doc) for doc in docs]
        
        if self._provider == "openai":
            response = self._client.embeddings.create(
                input=processed_docs,
                model=self.model_name
            ).data
            return [item.embedding for item in response]
        
        if self._provider == "huggingface":
            inputs = self._tokenizer(processed_docs, padding=True, truncation=True, return_tensors="pt")
            with no_grad():
                outputs = self._model(**inputs)
            vectors = mean(outputs.last_hidden_state, dim=1).tolist()
        elif self._provider == "sentencetransformers":
            vectors = self._model.encode(processed_docs, convert_to_tensor=True).tolist()
        else:
            raise PuppyException(3300, "Unsupported Embedding Model Provider", f"Embedder provider {self._provider} is unsupported!")
        return vectors

    @classmethod
    def clear_cache(cls, model_name: str = None):
        """清理模型缓存"""
        with cls._lock:
            if model_name:
                if model_name in cls._model_cache:
                    del cls._model_cache[model_name]
            else:
                cls._model_cache.clear()


# class MultiModalEmbedder:
#     def __init__(
#         self,
#         model_name: str = 'jinaai/jina-clip-v1'

#     ):
#         self.model = AutoModel.from_pretrained(model_name, trust_remote_code=True)

#     @global_exception_handler(3202, "Error Encoding Text")
#     def encode_text(
#         self,
#         sentences: List[str]
#     ):
#         return self.model.encode_text(sentences)

#     @global_exception_handler(3203, "Error Encoding Image")
#     def encode_image(
#         self,
#         image_sources: List[Union[str, Image.Image]]
#     ):
#         images = [self.load_image(img) for img in image_sources]
#         return self.model.encode_image(images)

#     @staticmethod
#     @global_exception_handler(3204, "Error Loading Image")
#     def load_image(
#         image_source: Union[str, Image.Image]
#     ) -> Image.Image:
#         if isinstance(image_source, str) and image_source.startswith('http'):
#             response = requests.get(image_source)
#             return Image.open(BytesIO(response.content))
#         elif isinstance(image_source, str):
#             return Image.open(image_source)
#         elif isinstance(image_source, Image.Image):
#             return image_source
#         else:
#             raise ValueError("Unsupported image source format.")

#     def compute_similarity(
#         self,
#         embeddings1: Tensor,
#         embeddings2: Tensor
#     ) -> float:
#         if not isinstance(embeddings1, Tensor):
#             embeddings1 = tensor(embeddings1)
#         if not isinstance(embeddings2, Tensor):
#             embeddings2 = tensor(embeddings2)

#         # Compute the similarity matrix
#         similarity_matrix = matmul(embeddings1, embeddings2.T)

#         # Calculate the average similarity score
#         average_similarity = mean(similarity_matrix).item()

#         return average_similarity

#     @global_exception_handler(3205, "Error Computing Text-Image Similarity")
#     def text_image_similarity(
#         self,
#         text_inputs: List[str],
#         image_inputs: List[str]
#     ):
#         text_embeddings = self.encode_text(text_inputs)
#         image_embeddings = self.encode_image(image_inputs)
        
#         similarities = self.compute_similarity(text_embeddings, image_embeddings)
#         return similarities


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    
    docs = ["6grGax"]

    with TextEmbedder("text-embedding-ada-002") as embedder:
        print(embedder.embed(docs))

    # with TextEmbedder("BAAI/bge-m3") as embedder:
    #     print(embedder.embed(docs))

    # with TextEmbedder("all-MiniLM-L6-v2") as embedder:
    #     print(embedder.embed(docs))
    

    TextEmbedder.clear_cache()

    # multi-modal
    # embedder = MultiModalEmbedder()
    # text_inputs = ['A blue cat', 'A red cat']
    # image_inputs = [
    #     'https://i.pinimg.com/600x315/21/48/7e/21487e8e0970dd366dafaed6ab25d8d8.jpg',
    #     'https://i.pinimg.com/736x/c9/f2/3e/c9f23e212529f13f19bad5602d84b78b.jpg'
    # ]
    # similarities = embedder.text_image_similarity(text_inputs, image_inputs)
    # print(similarities)
