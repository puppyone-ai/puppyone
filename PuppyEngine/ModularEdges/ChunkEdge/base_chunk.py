# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from abc import ABC, abstractmethod
from typing import List, Dict, Optional
from DataClass.Chunk import Chunk
from Utils.PuppyEngineExceptions import global_exception_handler


class BaseChunk(ABC):
    def __init__(
        self,
        documents: Optional[str|List[str]] = None
    ):
        self.documents = documents

    @abstractmethod
    def chunk(
        self,
        sub_mode: str,
        extra_configs: dict
    ) -> List[Chunk]:
        pass

    @global_exception_handler(3100, "Error Converting List to Chunks")
    def list_to_chunks(
        self,
        chunk_dicts: List[Dict]
    ) -> List[Chunk]:
        return [Chunk.from_dict(chunk_dict) for chunk_dict in chunk_dicts]

    @global_exception_handler(3101, "Error Converting Contents to Chunks")
    def contents_to_chunks(
        self,
        contents: List[str]
    ) -> List[Chunk]:
        return [
            Chunk.from_dict({
                "content": content,
                "metadata": {
                    "id": i
                }
            }) for i, content in enumerate(contents) if content.strip()
        ]
