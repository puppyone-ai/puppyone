# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import re
import numpy as np
from typing import List, Dict, Optional
from sklearn.metrics.pairwise import cosine_similarity
from DataClass.Chunk import Chunk
from ModularEdges.ChunkEdge.base_chunk import BaseChunk
from Utils.PuppyEngineExceptions import global_exception_handler


class SpecialChunking(BaseChunk):
    def __init__(
        self, 
        documents: str
    ):
        super().__init__(documents)

    def chunk(
        self,
        sub_mode: str,
        extra_configs: dict
    ) -> List[Chunk]:
        match sub_mode.lower():
            case "recursive":
                return self.list_to_chunks(self.recursive_text_splitter(
                    max_length=extra_configs.get("extra_configs", 200)
                ))
            case "semantic":
                return self.list_to_chunks(self.semantic_chunk(
                    docs=extra_configs.get("docs", []),
                    embeddings=extra_configs.get("embeddings", []),
                    threshold=extra_configs.get("threshold", 0.75),
                    top_k=extra_configs.get("top_k", None)
                ))
            case _:
                raise ValueError("Unsupported Sub Chunking Mode for Special Chunk")

    @global_exception_handler(3108, "Error Executing Recursive-Chunk")
    def recursive_text_splitter(
        self,
        max_length: int = 200,
    ) -> List[Dict[str, str]]:
        """
        Recursively splits the document by sentences or paragraphs until chunks are under a specified max length.
        """

        def split_recursively(text: str) -> List[str]:
            if len(text) <= max_length:
                return [text]

            # Split by sentences or paragraphs
            sentences = re.split(r"(?<=[.!?]) +", text)
            chunks = []
            current_chunk = ""
            for sentence in sentences:
                if len(current_chunk) + len(sentence) <= max_length:
                    current_chunk += " " + sentence
                else:
                    chunks.append(current_chunk.strip())
                    current_chunk = sentence
            if current_chunk:
                chunks.append(current_chunk.strip())
            return chunks

        split_chunks = split_recursively(self.documents)
        chunks = [
            {
                "content": chunk,
                "metadata": {"id": i}}
            for i, chunk in enumerate(split_chunks) if chunk.strip()
        ]
        return chunks

    @global_exception_handler(3107, "Error Executing Semantic-Chunk")
    def semantic_chunk(
        self,
        docs: List[str],
        embeddings: List[list],
        threshold: Optional[float] = 0.75,
        top_k: Optional[int] = None
    ) -> List[Dict[str, str]]:
        """
        Splits documents into chunks based on semantic similarity using either threshold or top-k similar embeddings.
        """

        chunks = []
        current_chunk = []
        current_embeddings = []

        for (doc, embedding) in zip(docs, embeddings):
            if not current_chunk:
                current_chunk.append(doc)
                current_embeddings.append(embedding)
                continue

            similarities = cosine_similarity([embedding], current_embeddings)
            if top_k:
                top_similarities = sorted(similarities[0], reverse=True)[:top_k]
                max_similarity = np.mean(top_similarities)
            else:
                max_similarity = np.max(similarities)

            if threshold is not None and max_similarity < threshold:
                chunks.append(current_chunk)
                current_chunk = [doc]
                current_embeddings = [embedding]
            else:
                current_chunk.append(doc)
                current_embeddings.append(embedding)

        if current_chunk:
            chunks.append(current_chunk)

        chunks = [
            {
                "content": "".join(doc_list),
                "metadata": {
                    "id": chunk_id
                }
            } for chunk_id, doc_list in enumerate(chunks) if doc_list
        ]

        return chunks


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    
    # Test for semantic_chunk method
    import numpy as np
    
    # Create some example documents
    docs = """
The quick brown fox jumps over the lazy dog.
A fast brown animal jumps over a sleeping dog. 
The sky is blue and the sun is shining.
Blue skies and bright sun are wonderful.
The dog is sleeping under the tree.
    """
    doc_list = docs.split(".")
    rng = np.random.default_rng(seed=42)
    embeddings = [rng.random(512).tolist() for _ in docs]
    print("Testing with threshold=0.75:")
    chunks = SpecialChunking(docs).chunk("semantic", {
        "docs": doc_list,
        "embeddings": embeddings,
        "threshold": 0.75
    })
    print("chunks 1: ", chunks)
    print("\nTesting with top_k=2:")
    chunks = SpecialChunking(docs).chunk("semantic", {
        "docs": doc_list,
        "embeddings": embeddings,
        "top_k": 2})
    print("chunks 2: ", chunks)
    print("\nTesting with threshold=0.5 and top_k=2:")
    chunks = SpecialChunking(docs).chunk("semantic", {
        "docs": doc_list,
        "embeddings": embeddings,
        "threshold": 0.5,
        "top_k": 2
    })
    print("chunks 3: ", chunks)

    sample_text = (
        "Artificial Intelligence (AI) is rapidly evolving. "
        "It can now perform complex tasks. Some believe AI will surpass human intelligence. "
        "Others argue that AI can only assist in specific tasks."
    )
    print("Recursive Text Splitter:")
    print(SpecialChunking(sample_text).chunk("recursive", {
        "max_length": 50
    }))
