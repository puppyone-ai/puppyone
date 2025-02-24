# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import numpy as np
from typing import List, Dict, Any
from ModularEdges.ChunkEdge.llm_chunk import LLMChunking
from ModularEdges.ChunkEdge.auto_chunk import AutoChunking
from ModularEdges.ChunkEdge.length_chunk import LengthChunking
from ModularEdges.ChunkEdge.special_chunk import SpecialChunking
from ModularEdges.ChunkEdge.advanced_chunk import AdvancedChunking
from ModularEdges.ChunkEdge.character_chunk import CharacterChunking
from ModularEdges.EdgeFactoryBase import EdgeFactoryBase
from Utils.PuppyEngineExceptions import global_exception_handler


class ChunkerFactory(EdgeFactoryBase):
    @staticmethod
    @global_exception_handler(3100, "Error Initializing Chunking Method")
    def execute(
        init_configs: Dict[str, Any] = None,
        extra_configs: Dict[str, Any] = None
    ) -> List[Dict[str, Any]]:
        chunking_classes = {
            "auto": AutoChunking,
            "length": LengthChunking,
            "llm": LLMChunking,
            "character": CharacterChunking,
            "advanced": AdvancedChunking,
            "special": SpecialChunking
        }
        chunking_mode = init_configs.get("chunking_mode", "auto")
        sub_chunking_mode = init_configs.get("sub_chunking_mode")
        doc = init_configs.get("doc")

        chunking_class = chunking_classes.get(chunking_mode.lower())
        if not chunking_class:
            raise ValueError(f"Unsupported Chunking Mode: {chunking_mode} is unsupported!")

        chunks = chunking_class(doc).chunk(sub_chunking_mode, extra_configs)
        return [chunk_dict.to_dict() for chunk_dict in chunks]


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    doc = """
Artificial Intelligence (AI) is the simulation of human intelligence in machines.
AI systems are used to perform tasks that normally require human intelligence.
There are two types of AI: narrow AI and general AI.
Narrow AI is designed to perform a narrow task like facial recognition.
General AI, on the other hand, is a form of intelligence that can perform any intellectual task that a human can do.
"""
    print("LLM Chunking: ", ChunkerFactory.execute(init_configs={"chunking_mode": "llm", "doc": doc}))
    print("Auto Chunking -- Text: ", ChunkerFactory.execute(init_configs={"chunking_mode": "auto", "doc": doc}))

    json_input = """
{
    "name": "John",
    "age": 30,
    "address": {
        "street": "123 Main St",
        "city": "New York"
    },
    "phones": ["123-4567", "234-5678"]
}
    """
    print("Auto Chunking -- JSON 1: ", ChunkerFactory.execute(init_configs={"chunking_mode": "auto", "doc": json_input}))
    json_input = """
[{
    "name": "John",
    "age": 30,
    "address": {
        "street": "123 Main St",
        "city": "New York"
    },
    "phones": ["123-4567", "234-5678"]
}]
    """
    print("Auto Chunking -- JSON 2: ", ChunkerFactory.execute(init_configs={"chunking_mode": "auto", "doc": json_input}))
    json_input = [{
    "name": "John",
    "age": 30,
    "address": {
        "street": "123 Main St",
        "city": "New York"
    },
    "phones": ["123-4567", "234-5678"]
}]
    print("Auto Chunking -- JSON list: ", ChunkerFactory.execute(init_configs={"chunking_mode": "auto", "doc": json_input}))

    documents = "The quick brown fox jumps over the lazy dog. The dog barks at the fox."
    
    with open("PuppyEngine/developer.md", "r") as f:
        documents = f.read()

    chunks = ChunkerFactory.execute(init_configs={"chunking_mode": "length", "sub_chunking_mode": "size", "doc": documents, "chunk_size": 100, "overlap": 20, "handle_half_word": True})
    for chunk in chunks:
        print(chunk)

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
    chunks = ChunkerFactory.execute(init_configs={"chunking_mode": "special", "sub_chunking_mode": "semantic", "doc": docs, "docs": doc_list, "embeddings": embeddings, "threshold": 0.75})
    print("chunks 1: ", chunks)
    print("\nTesting with top_k=2:")
    chunks = ChunkerFactory.execute(init_configs={"chunking_mode": "special", "sub_chunking_mode": "semantic", "doc": docs, "docs": doc_list, "embeddings": embeddings, "top_k": 2})
    print("chunks 2: ", chunks)
    print("\nTesting with threshold=0.5 and top_k=2:")
    chunks = ChunkerFactory.execute(init_configs={"chunking_mode": "special", "sub_chunking_mode": "semantic", "doc": docs, "docs": doc_list, "embeddings": embeddings, "threshold": 0.5, "top_k": 2})
    print("chunks 3: ", chunks)

    sample_text = (
        "Artificial Intelligence (AI) is rapidly evolving. "
        "It can now perform complex tasks. Some believe AI will surpass human intelligence. "
        "Others argue that AI can only assist in specific tasks."
    )
    sample_html = """
<html>
<head><title>Test HTML</title></head>
<body>
<h1>Header 1</h1>
<p>This is a paragraph.</p>
<h2>Header 2</h2>
<p>This is another paragraph.</p>
</body>
</html>
    """
    sample_markdown = """
# Header 1
Hi this is Jim

## Header 2
Hi this is Joe

### Header 3
Hi this is Molly
    """
    print("Recursive Text Splitter:")
    print(ChunkerFactory.execute(init_configs={"chunking_mode": "special", "sub_chunking_mode": "recursive", "doc": sample_text, "max_length": 50}))
    print("\nToken Splitter:")
    print(ChunkerFactory.execute(init_configs={"chunking_mode": "length", "sub_chunking_mode": "token", "doc": sample_text, "max_tokens": 10}))
    print("\nSplit by User Specified Characters:")
    csv_doc = "Name, Age, Country\nAlice, 30, USA\nBob, 25, UK"
    print(ChunkerFactory.execute(init_configs={"chunking_mode": "character", "sub_chunking_mode": "character", "doc": csv_doc}))
    print("\nHTML Splitter with user-specified tags:")
    print(ChunkerFactory.execute(init_configs={"chunking_mode": "advanced", "sub_chunking_mode": "html", "doc": sample_html, "tags": [("h1", "Header 1"), ("h2", "Header 2")]}))
    print("\nHTML Splitter with default tags:")
    print(ChunkerFactory.execute(init_configs={"chunking_mode": "advanced", "sub_chunking_mode": "html", "doc": sample_html}))

    # Test Markdown Splitter with user-specified tags
    print("\nMarkdown Splitter with user-specified tags:")
    print(ChunkerFactory.execute(init_configs={"chunking_mode": "advanced", "sub_chunking_mode": "markdown", "doc": sample_markdown, "tags": [("h1", "Header 1"), ("h2", "Header 2")]}))
    print("\nMarkdown Splitter with default tags:")
    print(ChunkerFactory.execute(init_configs={"chunking_mode": "advanced", "sub_chunking_mode": "markdown", "doc": sample_markdown}))
