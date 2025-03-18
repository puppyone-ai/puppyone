# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import re
from typing import List
from DataClass.Chunk import Chunk
from ModularEdges.ChunkEdge.base_chunk import BaseChunk
from Utils.puppy_exception import global_exception_handler


class SimpleChunking(BaseChunk):
    def __init__(
        self,
        documents: str
    ):
        super().__init__(documents)

    @global_exception_handler(3101, "Error Executing Auto-Chunk")
    def chunk(
        self,
        sub_mode: str = "",
        extra_configs: dict = {}
    ) -> List[Chunk]:
        """
        Automatically chunk the input text based on the specified text type.
        Supports plain text, JSON, and Markdown.
        """

        if isinstance(self.documents, str):
            return self.contents_to_chunks(self._chunk_text())
        elif isinstance(self.documents, list):
            return self.contents_to_chunks(self._chunk_list())
        elif isinstance(self.documents, dict):
            return self.contents_to_chunks(self._chunk_json())
        else:
            raise ValueError(f"Unsupported Input Type for Auto Chunk: Type {type(self.documents)}")

    def _chunk_text(
        self
    ) -> List[str]:
        """
        Chunk a text string, split by newlines.
        """

        # Define multilingual sentence-ending delimiters
        delimiters = (
            r"[.!?]"                # English and similar
            r"|[。！？]"             # Chinese, Japanese, Korean (CJK)
            r"|[۔؟]"                # Arabic, Persian
            r"|[।]"                 # Hindi, Indic languages
            r"|[።၊။།]"             # Ethiopic, Myanmar, Tibetan
            r"|(?:\r?\n)+"          # Newlines
        )

         # Split but keep delimiters using positive lookahead
        chunks = re.split(f"({delimiters})", self.documents)

        # Filter out empty strings and combine delimiter with previous chunk
        result = []
        current_chunk = ""

        for chunk in chunks:
            if chunk:  # Skip empty strings
                if re.match(delimiters, chunk):
                    current_chunk += chunk
                    result.append(current_chunk)
                    current_chunk = ""
                else:
                    current_chunk = chunk

        # Add any remaining chunk
        if current_chunk:
            result.append(current_chunk)
            
        return result


    def _chunk_list(
        self
    ) -> List[str]:
        """
        Chunk a list, convert each list element to string and split by element.
        """

        return [str(element) for element in self.documents]

    def _chunk_json(
        self
    ) -> List[str]:
        """
        Chunk JSON data, preserving the structure.
        """

        flattened_content = []
        if isinstance(self.documents, dict):
            flattened_content = self._flatten_json(self.documents)
        elif isinstance(self.documents, list):
            for data in self.documents:
                flattened_content.extend(self._flatten_json(data))
        return flattened_content

    def _flatten_json(
        self,
        y: dict,
        parent_key="",
        sep="."
    ) -> List[str]:
        """
        Flatten a nested JSON object into a list of strings.
        """

        items = []
        for k, v in y.items():
            new_key = f"{parent_key}{sep}{k}" if parent_key else k
            if isinstance(v, dict):
                items.extend(self._flatten_json(v, new_key, sep=sep))
            elif isinstance(v, list):
                for i, item in enumerate(v):
                    items.extend(self._flatten_json({f"{new_key}[{i}]": item}, sep=sep))
            else:
                items.append(f"{new_key}: {v}")
        return items

    


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    doc = "    Agent, the term became a hot topic in 2023—you've probably heard of AutoGPT, Stanford Town, BabyAGI, and countless other \"LLM-based agents.\"These are not just concepts; they are real agents that can sense their environment, plan their next steps, and carry out tasks."
    chunker = SimpleChunking(doc)
    chunk1 = chunker.chunk()
    print("Auto Chunking -- Text: ", chunk1)
    chunker2 = SimpleChunking(chunk1)
    chunk2 = chunker2.chunk()
    print("Auto Chunking -- List: ", chunk2)

    doc = """
Artificial Intelligence (AI) is the simulation of human intelligence in machines.
AI systems are used to perform tasks that normally require human intelligence.
There are two types of AI: narrow AI and general AI.
Narrow AI is designed to perform a narrow task like facial recognition.
General AI, on the other hand, is a form of intelligence that can perform any intellectual task that a human can do.
"""
    chunker = SimpleChunking(doc)
    
    print("Auto Chunking -- Text: ", chunker.chunk("text", {}))

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
    print("Auto Chunking -- JSON 1: ", chunker.chunk("json", {}))
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
    print("Auto Chunking -- JSON 2: ", chunker.chunk("json", {}))
    json_input = [{
    "name": "John",
    "age": 30,
    "address": {
        "street": "123 Main St",
        "city": "New York"
    },
    "phones": ["123-4567", "234-5678"]
}]
    print("Auto Chunking -- JSON list: ", chunker.chunk("json", {}))
