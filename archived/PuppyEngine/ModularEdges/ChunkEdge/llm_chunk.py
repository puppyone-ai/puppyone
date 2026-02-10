# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import re
import ast
from typing import List
from DataClass.Chunk import Chunk
from ModularEdges.ChunkEdge.base_chunk import BaseChunk
from ModularEdges.LLMEdge.llm_edge import remote_llm_chat
from Utils.puppy_exception import global_exception_handler


class LLMChunking(BaseChunk):
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
            case "llm":
                return self.contents_to_chunks(self.llm_chunk(
                    prompt=extra_configs.get("prompt", None),
                    model=extra_configs.get("model", {"openai/gpt-5": {}})
                ))
            case _:
                raise ValueError("Unsupported Sub Chunking Mode for LLM Chunk")

    @global_exception_handler(3109, "Error Executing LLM-Chunk")
    def llm_chunk(
        self,
        prompt: str = None,
        model: str = "openai/gpt-5"
    ) -> List[str]:
        # System prompt guiding the LLM to understand the task
        sys_prompt = """
You are an expert document chunker. Your task is to split the original document into semantically meaningful chunks. 
Ensure that the document is chunked in a way that each chunk contains coherent and complete thoughts or ideas.

Important Guidelines:
- Each chunk should be a collection of sentences that talk about a similar topic.
- Ensure that no sentence is split between chunks; keep all sentences intact within the same chunk.
- The chunks should preserve the natural flow of the content but break the text down into digestible parts.
- The chunks should not exceed a length where meaning might be lost but should also not be too short, avoid one-liner chunks unless necessary.
- Return the chunks in a valid json object, where contains one `chunks` field only and the value is a list of string each represent a chunk.

## Examples:
The original document: "Artificial Intelligence is rapidly evolving. It can now perform complex tasks. Some believe AI will surpass human intelligence. Others argue that AI can only assist in specific tasks."
Desired Output in json format:
{
    "chunks": [
        "Artificial Intelligence is rapidly evolving. It can now perform complex tasks.",
        "Some believe AI will surpass human intelligence. Others argue that AI can only assist in specific tasks."
    ]
}

The original document: "The quick brown fox jumps over the lazy dog. The dog barks at the fox."
Desired Output in json:
{
    "chunks": [
        "The quick brown fox jumps over the lazy dog.",
        "The dog barks at the fox."
    ]
}

**Note**: Always output with a valid json with the `chunks` field as the key and a list of chunks in sequence.
        """

        # Use sys_prompt if no user-supplied prompt is provided
        prompt = prompt if prompt else sys_prompt

        messages = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": f"The original document: {self.documents}"}
        ]

        structure = {
            "type": "json_schema",
            "json_schema": {
                "name": "chunk_json",
                "schema": {
                    "type": "object",
                    "properties": {
                        "chunks": {
                            "type": "array",
                            "items": {
                                "type": "string"
                            }
                        }
                    },
                    "required": ["chunks"]
                }
            }
        }

        # Call to the LLM chat function
        response = remote_llm_chat(
            messages=messages,
            model=model,
            temperature=0.9,
            max_tokens=4096,
            printing=False,
            stream=False,
            response_format=structure,
            hoster="openrouter"
        )

        return self._parse_chunks(response)

    @global_exception_handler(3110, "Error Parsing Chunks from LLM Response")
    def _parse_chunks(
        self,
        response: str
    ) -> List[str]:
        """
        Parse the response from the LLM and convert it into a list of chunks (list of strings).
        """

        # Use regex to find the list of chunks within the response
        list_pattern = re.search(r"\[(?:[^\[\]]*?\])+", response, re.DOTALL)
        
        if list_pattern:
            list_str = list_pattern.group(0)
            chunks = ast.literal_eval(list_str)

            # Ensure it"s a list of strings
            if isinstance(chunks, list) and all(isinstance(item, str) for item in chunks):
                return chunks
            else:
                raise ValueError(f"Extracted content is not a list of strings: {chunks}")
        else:
            raise ValueError(f"No list found in LLM response: {response}")


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    
    docs = """
Artificial Intelligence is rapidly evolving. It can now perform complex tasks. Some believe AI will surpass human intelligence. Others argue that AI can only assist in specific tasks.
    """
    print(LLMChunking(docs).chunk("llm", {}))
