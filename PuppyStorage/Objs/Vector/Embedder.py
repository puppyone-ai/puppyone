# If you are a VS Code users:
import os
import sys
import requests
from typing import List, Union
from io import BytesIO
from PIL import Image
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from abc import ABC, abstractmethod

from openai import OpenAI
from transformers import AutoTokenizer, AutoModel
from sentence_transformers import SentenceTransformer
from torch import no_grad, Tensor, tensor, mean, matmul
from Utils.PuppyEngineExceptions import PuppyEngineException, global_exception_handler


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


class TextEmbedding(Embedder):
    """
    Unified text embedding class supporting HuggingFace, SentenceTransformer, and OpenAI.
    """

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
        self.provider = self.model_provider_dict.get(model_name, "openai")
        self._initialize_model()

    @global_exception_handler(3200, "Error Initializing Embedding Model")
    def _initialize_model(self):
        """
        Initializes the model based on the provider.
        """

        if self.provider == "huggingface":
            self.model = AutoModel.from_pretrained(self.model_name)
            self.tokenizer = AutoTokenizer.from_pretrained(self.model_name)
        elif self.provider == "sentencetransformers":
            self.model = SentenceTransformer(self.model_name)
        elif self.provider == "openai":
            if not self.api_key:
                raise PuppyEngineException(3301, "Missing Embedding Model API Key", "API key is required for OpenAI Embedding!")
            self.client = OpenAI(api_key=self.api_key)
        else:
            raise PuppyEngineException(3300, "Unsupported Embedding Model Provider", f"Embedder provider {self.provider} is unsupported!")

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

        if self.provider == "huggingface":
            inputs = self.tokenizer(docs, padding=True, truncation=True, return_tensors="pt")
            with no_grad():
                outputs = self.model(**inputs)
            embeddings = mean(outputs.last_hidden_state, dim=1).tolist()
        elif self.provider == "sentencetransformers":
            embeddings = self.model.encode(docs, convert_to_tensor=True).tolist()
        elif self.provider == "openai":
            docs = [doc.replace("\n", " ") for doc in docs]
            response = self.client.embeddings.create(input=docs, model=self.model_name).data
            embeddings = [item.embedding for item in response]
        else:
            raise ValueError(f"Unsupported Embedding Model Provider: {self.provider}!")
        return embeddings


class MultiModalEmbedding:
    def __init__(
        self,
        model_name: str = 'jinaai/jina-clip-v1'

    ):
        self.model = AutoModel.from_pretrained(model_name, trust_remote_code=True)

    @global_exception_handler(3202, "Error Encoding Text")
    def encode_text(
        self,
        sentences: List[str]
    ):
        return self.model.encode_text(sentences)

    @global_exception_handler(3203, "Error Encoding Image")
    def encode_image(
        self,
        image_sources: List[Union[str, Image.Image]]
    ):
        images = [self.load_image(img) for img in image_sources]
        return self.model.encode_image(images)

    @staticmethod
    @global_exception_handler(3204, "Error Loading Image")
    def load_image(
        image_source: Union[str, Image.Image]
    ) -> Image.Image:
        if isinstance(image_source, str) and image_source.startswith('http'):
            response = requests.get(image_source)
            return Image.open(BytesIO(response.content))
        elif isinstance(image_source, str):
            return Image.open(image_source)
        elif isinstance(image_source, Image.Image):
            return image_source
        else:
            raise ValueError("Unsupported image source format.")

    def compute_similarity(
        self,
        embeddings1: Tensor,
        embeddings2: Tensor
    ) -> float:
        if not isinstance(embeddings1, Tensor):
            embeddings1 = tensor(embeddings1)
        if not isinstance(embeddings2, Tensor):
            embeddings2 = tensor(embeddings2)

        # Compute the similarity matrix
        similarity_matrix = matmul(embeddings1, embeddings2.T)

        # Calculate the average similarity score
        average_similarity = mean(similarity_matrix).item()

        return average_similarity

    @global_exception_handler(3205, "Error Computing Text-Image Similarity")
    def text_image_similarity(
        self,
        text_inputs: List[str],
        image_inputs: List[str]
    ):
        text_embeddings = self.encode_text(text_inputs)
        image_embeddings = self.encode_image(image_inputs)
        
        similarities = self.compute_similarity(text_embeddings, image_embeddings)
        return similarities


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    
    docs = ["This is a sample text.", "This is another sentence."]
    huggerface_embedder = TextEmbedding("BAAI/bge-m3")
    print(huggerface_embedder.embed(docs))

    sentencetransformers_embedder = TextEmbedding("all-MiniLM-L6-v2")
    print(sentencetransformers_embedder.embed(docs))
    
    openai_embedder = TextEmbedding("text-embedding-ada-002")
    print(openai_embedder.embed(docs))

    # multi-modal
    embedder = MultiModalEmbedding()
    text_inputs = ['A blue cat', 'A red cat']
    image_inputs = [
        'https://i.pinimg.com/600x315/21/48/7e/21487e8e0970dd366dafaed6ab25d8d8.jpg',
        'https://i.pinimg.com/736x/c9/f2/3e/c9f23e212529f13f19bad5602d84b78b.jpg'
    ]
    similarities = embedder.text_image_similarity(text_inputs, image_inputs)
    print(similarities)
