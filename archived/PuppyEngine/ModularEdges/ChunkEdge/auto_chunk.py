# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from typing import List
from DataClass.Chunk import Chunk
from ModularEdges.ChunkEdge.base_chunk import BaseChunk
from Utils.puppy_exception import global_exception_handler


class AutoChunking(BaseChunk):
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
        Automatically chunk the input text based on the size and separators.
        """

        self.chunk_size = extra_configs.get("chunk_size", 1000)
        self.chunk_overlap = extra_configs.get("chunk_overlap", 200)
        self.separators = extra_configs.get("separators", ["\n\n", "\n", ". ", ", ", " "])
        chunks = self._split_recursive(self.documents, self.separators.copy())
        return self.contents_to_chunks(chunks)

    def _split_recursive(
        self,
        text: str,
        separators: List[str]
    ) -> List[str]:
        if len(text) <= self.chunk_size:
            return [text]
        if not separators:
            return self._split_fixed(text)

        current_sep = separators.pop(0)
        parts = self._split_on_sep(text, current_sep)
        new_parts = []
        for part in parts:
            if len(part) > self.chunk_size:
                subparts = self._split_recursive(part, separators.copy())
                new_parts.extend(subparts)
            else:
                new_parts.append(part)
        return new_parts

    def _split_on_sep(
        self,
        text: str,
        sep: str
    ) -> List[str]:
        parts = []
        start = 0
        sep_len = len(sep)
        while True:
            idx = text.find(sep, start)
            if idx == -1:
                if start <= len(text):
                    parts.append(text[start:])
                break
            end = idx + sep_len
            parts.append(text[start:end])
            start = end

        # Remove the last part if it's empty (when text ends with the separator)
        if parts and parts[-1] == '':
            parts.pop()
        return parts

    def _split_fixed(
        self,
        text: str
    ) -> List[str]:
        chunks = []
        start = 0
        while start < len(text):
            end = start + self.chunk_size
            chunks.append(text[start:end])
            start += (self.chunk_size - self.chunk_overlap)
        return chunks


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    doc = "    Agent, the term became a hot topic in 2023—you've probably heard of AutoGPT, Stanford Town, BabyAGI, and countless other \"LLM-based agents.\"These are not just concepts; they are real agents that can sense their environment, plan their next steps, and carry out tasks."
    chunker = AutoChunking(doc)
    print(chunker.chunk("", {}))

    doc = """
Artificial Intelligence (AI) is the simulation of human intelligence in machines.
AI systems are used to perform tasks that normally require human intelligence.
There are two types of AI: narrow AI and general AI.
Narrow AI is designed to perform a narrow task like facial recognition.
General AI, on the other hand, is a form of intelligence that can perform any intellectual task that a human can do.
"""
    chunker = AutoChunking(doc)
    extra_configs = {
        "chunk_size": 100,
        "chunk_overlap": 80,
        "separators": ["\n\n", "\n", ". ", ", ", " "]
    }
    print("Auto Chunking -- Text: ", chunker.chunk("", extra_configs))

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
    chunker = AutoChunking(json_input)
    extra_configs = {
        "chunk_size": 100,
        "chunk_overlap": 10,
        "separators": ["\n\n", "\n", "{", "}", '"', ", ", ":"]
    }
    print("Auto Chunking -- JSON: ", chunker.chunk("", extra_configs))
