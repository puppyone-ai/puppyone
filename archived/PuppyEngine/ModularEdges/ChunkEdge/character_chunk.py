# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import re
from typing import List
from DataClass.Chunk import Chunk
from ModularEdges.ChunkEdge.base_chunk import BaseChunk
from Utils.puppy_exception import global_exception_handler


class CharacterChunking(BaseChunk):
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
            case "character":
                delimiters = extra_configs.get("delimiters", [",", ";"])
                return self.list_to_chunks(self.split_by_chars(delimiters))
            case _:
                raise ValueError("Unsupported Sub Chunking Mode for Character Chunk")

    @global_exception_handler(3104, "Error Executing Character-Chunk")
    def split_by_chars(
        self,
        delimiters: List[str] = [",", ";"]
    ) -> List[Chunk]:
        """
        Splits text based on user-specified characters.
        """

        delimiter_pattern = "|".join(map(re.escape, delimiters))
        split_text = re.split(delimiter_pattern, self.documents)

        chunks = [{
                "content": chunk.strip(),
                "metadata": {"id": i}}
            for i, chunk in enumerate(split_text) if chunk.strip()
        ]
        return chunks


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    docs = """
The quick brown fox jumps over the lazy dog.
A fast brown animal jumps over a sleeping dog. 
The sky is blue and the sun is shining.
Blue skies and bright sun are wonderful.
The dog is sleeping under the tree.
    """
    print(CharacterChunking(docs).chunk("character", {"delimiters": ["."]}))
    csv_doc = "Name, Age, Country\nAlice, 30, USA\nBob, 25, UK"
    print(CharacterChunking(csv_doc).chunk("character", {"delimiters": [",", "\n"]}))
   
