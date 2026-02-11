# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from typing import List, Dict, Tuple, Optional
from transformers import AutoTokenizer
from DataClass.Chunk import Chunk
from ModularEdges.ChunkEdge.base_chunk import BaseChunk
from Utils.puppy_exception import global_exception_handler


class LengthChunking(BaseChunk):
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
            case "size":
                return self.list_to_chunks(self.size_chunk(
                    chunk_size=extra_configs.get("chunk_size", 100),
                    overlap=extra_configs.get("overlap", 0),
                    handle_half_word=extra_configs.get("handle_half_word", False),
                    split_chars=extra_configs.get("split_chars", None)
                ))
            case "token":
                return self.list_to_chunks(self.token_splitter(
                    model_name=extra_configs.get("model_name", "bert-base-uncased"),
                    max_tokens=extra_configs.get("max_tokens", 200)
                ))
            case _:
                raise ValueError("Unsupported Sub Chunking Mode for Length Chunk")

    @global_exception_handler(3102, "Error Executing Size-Chunk")
    def size_chunk(
        self, 
        chunk_size: int, 
        overlap: int = 0, 
        handle_half_word: bool = False, 
        split_chars: Optional[set[str]] = None
    ) -> List[Dict[str, str]]:
        """
        Generalized chunking method that can handle both strict and soft chunking based on parameters.
        """

        # Ensure space is always a split character
        split_chars = split_chars or {" ", ".", ",", ";", ":", "?", "!", "~"}
        split_chars.add(" ")

        chunks: List[Chunk] = []
        start_index = 0
        chunk_id = 0
        text_length = len(self.documents)

        while start_index < text_length:
            end_index = min(start_index + chunk_size, text_length)
            chunk_content = self.documents[max(0, start_index - overlap):end_index]
            remaining_text = self.documents[end_index:]

            if handle_half_word:
                # Ensure the chunk starts with a full word
                chunk_content = self._append_previous_word(
                    start_index,
                    overlap,
                    chunk_content,
                    split_chars
                )

                # Ensure the chunk ends with a full word
                chunk_content, remaining_text, end_index = self._extend_chunk(
                    end_index,
                    text_length,
                    chunk_size,
                    remaining_text,
                    chunk_content,
                    split_chars
                )

            chunks.append({
                "content": chunk_content.strip(),
                "metadata": {"id": chunk_id}
            })
            chunk_id += 1
            start_index = end_index

        return chunks

    @global_exception_handler(3103, "Error Executing Token-Chunk")
    def token_splitter(
        self,
        model_name: str = "bert-base-uncased",
        max_tokens: int = 200
    ) -> List[Dict[str, str]]:
        """
        Splits text based on token count using a language model tokenizer.
        """

        tokenizer = AutoTokenizer.from_pretrained(model_name)
        tokens = tokenizer.tokenize(self.documents)

        chunks = []
        current_chunk = []
        current_token_count = 0

        # Reconstruct text chunks based on token limits
        for token in tokens:
            current_chunk.append(token)
            current_token_count += 1
            if current_token_count >= max_tokens:
                chunk_text = tokenizer.convert_tokens_to_string(current_chunk)
                chunks.append(chunk_text)
                current_chunk = []
                current_token_count = 0

        if current_chunk:
            chunk_text = tokenizer.convert_tokens_to_string(current_chunk)
            chunks.append(chunk_text)

        # Create Chunk objects with content and metadata
        chunks = [
            {
                "content": chunk,
                "metadata": {"id": i}
            } for i, chunk in enumerate(chunks) if chunk.strip()
        ]

        return chunks

    def _extend_chunk(
        self,
        end_index: int,
        text_length: int,
        chunk_size: int,
        remaining_text: str, 
        chunk_content: str, 
        split_chars: List[str]
    ) -> Tuple[str, str, int]:
        """
        Extend the chunk content to include next word.
        """

        if end_index < text_length and chunk_content[-1] not in split_chars:
            split_index = [remaining_text.find(char) for char in split_chars]
            split_index = [index for index in split_index if index != -1]
            if split_index:
                next_split_pos = min(split_index)
                if len(chunk_content) + next_split_pos <= chunk_size:
                    chunk_content += remaining_text[:next_split_pos+1]
                    remaining_text = remaining_text[next_split_pos+1:]
                    end_index += next_split_pos + 1
                else:
                    chunk_content, remaining_text, end_index = self._inner_cut(
                        chunk_size,
                        end_index,
                        remaining_text,
                        chunk_content,
                        split_chars
                    )

        return chunk_content, remaining_text, end_index
    
    def _inner_cut(
        self,
        chunk_size: int,
        end_index: int,
        remaining_text: str,
        chunk_content: str,
        split_chars: List[str]
    ) -> Tuple[str, str, int]:
        """
        Cut the chunk content at the nearest split character and adjust the remaining text.
        """

        cut_indexes = [index for index, c in enumerate(chunk_content) if c in split_chars]
        cut_indexes.sort(reverse=True)
        for cut_index in cut_indexes:
            if cut_index != -1 and cut_index <= chunk_size:
                end_index -= len(chunk_content) - cut_index + 1
                cut_content = chunk_content[cut_index+1:]
                chunk_content = chunk_content[:cut_index+1]
                remaining_text = cut_content + remaining_text
                break

        return chunk_content, remaining_text, end_index

    def _append_previous_word(
            self,
            start_index: int,
            overlap: int,
            chunk_content: str,  
            split_chars: List[str]
        ) -> str:
        """
        Append the previous word to the chunk content if overlap is specified.
        """

        if start_index > 0 and chunk_content[0] not in split_chars:
            previous_doc = self.documents[:start_index-overlap]
            split_index = [previous_doc.rfind(char) for char in split_chars]
            split_index = [index for index in split_index if index != -1]
            if split_index:
                max_split_index = max(split_index)
                chunk_content = previous_doc[max_split_index+1:] + chunk_content

        return chunk_content


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    documents = "The quick brown fox jumps over the lazy dog. The dog barks at the fox."
    with open("PuppyEngine/developer.md", "r") as f:
        documents = f.read()

    chunks = LengthChunking(documents).chunk("size", {"chunk_size": 100, "overlap": 20, "handle_half_word": True})
    for chunk in chunks:
        print(chunk)
