# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
from typing import List, Dict, Any
from ChunkEdge.llm_chunk import LLMChunking
from ChunkEdge.auto_chunk import AutoChunking
from ChunkEdge.length_chunk import LengthChunking
from ChunkEdge.special_chunk import SpecialChunking
from ChunkEdge.advanced_chunk import AdvancedChunking
from ChunkEdge.character_chunk import CharacterChunking
from Utils.PuppyEngineExceptions import global_exception_handler


class ChunkingFactory:
    @staticmethod
    @global_exception_handler(3100, "Error Initializing Chunking Method")
    def execute(
        chunking_mode: str,
        sub_mode: str,
        doc: str,
        extra_configs: dict
    ) -> List[Dict[str, Any]]:
        chunking_classes = {
            "auto": AutoChunking,
            "length": LengthChunking,
            "llm": LLMChunking,
            "character": CharacterChunking,
            "advanced": AdvancedChunking,
            "special": SpecialChunking
        }

        chunking_class = chunking_classes.get(chunking_mode.lower())
        if not chunking_class:
            raise ValueError(f"Unsupported Chunking Mode: {chunking_mode} is unsupported!")

        chunks = chunking_class(doc).chunk(sub_mode, extra_configs)
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
    chunker = LLMChunking(doc)
    
    print("LLM Chunking: ", ChunkingFactory.create_chunking("llm", "llm", doc, {}))
    print("Auto Chunking -- Text: ", ChunkingFactory.create_chunking("auto", doc))

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
    print("Auto Chunking -- JSON 1: ", ChunkingFactory.create_chunking("auto", json_input))
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
    print("Auto Chunking -- JSON 2: ", ChunkingFactory.create_chunking("auto", json_input))
    json_input = [{
    "name": "John",
    "age": 30,
    "address": {
        "street": "123 Main St",
        "city": "New York"
    },
    "phones": ["123-4567", "234-5678"]
}]
    print("Auto Chunking -- JSON list: ", ChunkingFactory.create_chunking("auto", json_input))

    documents = "The quick brown fox jumps over the lazy dog. The dog barks at the fox."
    
    with open("PuppyEngine/developer.md", "r") as f:
        documents = f.read()

    chunks = ChunkingFactory.create_chunking("length", "size", documents, chunk_size=100, overlap=20, handle_half_word=True)
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
    chunks = ChunkingFactory.create_chunking("special", "semantic", docs, docs=doc_list, embeddings=embeddings, threshold=0.75)
    print("chunks 1: ", chunks)
    print("\nTesting with top_k=2:")
    chunks = ChunkingFactory.create_chunking("special", "semantic", docs, docs=doc_list, embeddings=embeddings, top_k=2)
    print("chunks 2: ", chunks)
    print("\nTesting with threshold=0.5 and top_k=2:")
    chunks = ChunkingFactory.create_chunking("special", "semantic", docs, docs=doc_list, embeddings=embeddings, threshold=0.5, top_k=2)
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
    print(ChunkingFactory.create_chunking("special", "recursive", sample_text, max_length=50))
    print("\nToken Splitter:")
    print(ChunkingFactory.create_chunking("length", "token", sample_text, max_tokens=10))
    print("\nSplit by User Specified Characters:")
    csv_doc = "Name, Age, Country\nAlice, 30, USA\nBob, 25, UK"
    print(ChunkingFactory.create_chunking("character", "character", csv_doc))
    print("\nHTML Splitter with user-specified tags:")
    print(ChunkingFactory.create_chunking("advanced", "html", sample_html, tags=[("h1", "Header 1"), ("h2", "Header 2")]))
    print("\nHTML Splitter with default tags:")
    print(ChunkingFactory.create_chunking("advanced", "html", sample_html))

    # Test Markdown Splitter with user-specified tags
    print("\nMarkdown Splitter with user-specified tags:")
    print(ChunkingFactory.create_chunking("advanced", "markdown", sample_markdown, tags=[("h1", "Header 1"), ("h2", "Header 2")]))
    print("\nMarkdown Splitter with default tags:")
    print(ChunkingFactory.create_chunking("advanced", "markdown", sample_markdown))
