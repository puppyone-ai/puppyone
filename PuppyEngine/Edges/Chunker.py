# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import re
import ast
import numpy as np
from typing import List, Dict, Tuple, Optional
from bs4 import BeautifulSoup
from transformers import AutoTokenizer
from markdown2 import markdown
from sklearn.metrics.pairwise import cosine_similarity
from DataClass.Chunk import Chunk
from Edges.Generator import lite_llm_chat
from Utils.PuppyEngineExceptions import global_exception_handler


class AutoChunking:
    def __init__(
        self, 
        doc: str
    ):
        self.doc = doc

    def _create_chunks(
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

    @global_exception_handler(3101, "Error Executing Auto-Chunk")
    def chunk(
        self,
        sub_mode: str,
        extra_configs: dict
    ) -> List[Chunk]:
        """
        Automatically chunk the input text based on the specified text type.
        Supports plain text, JSON, and Markdown.
        """

        chunking_methods = {
            "str": self._chunk_text,
            "list": self._chunk_list,
            "dict": self._chunk_json,
            "markdown": self._chunk_markdown
        }

        chunking_method = chunking_methods.get(type(self.doc).__name__.lower())
        if not chunking_method:
            raise ValueError("Unsupported Sub Chunking Mode for Auto Chunk")

        chunks = chunking_method()

        return chunks
    
    def _chunk_text(
        self
    ) -> List[Chunk]:
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

        return self._create_chunks(re.split(delimiters, self.doc))

    def _chunk_list(
        self
    ) -> List[Chunk]:
        """
        Chunk a list, convert each list element to string and split by element.
        """

        # Convert each list element to a string
        stringified_list = [str(element) for element in self.doc]

        return self._create_chunks(stringified_list)

    def _chunk_json(
        self
    ) -> List[Chunk]:
        """
        Chunk JSON data, preserving the structure.
        """

        flattened_content = []
        if isinstance(self.doc, dict):
            flattened_content = self._flatten_json(self.doc)
        elif isinstance(self.doc, list):
            for data in self.doc:
                flattened_content.extend(self._flatten_json(data))
        return self._create_chunks(flattened_content)

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

    def _chunk_markdown(
        self
    ) -> List[Chunk]:
        """
        Chunk Markdown content, preserving the structure.
        """

        chunks = []
        markdown_data = self._load_markdown()
        for i, data in enumerate(markdown_data):
            chunk_lines = []
            for tag, content in data.items():
                if isinstance(content, dict):
                    inner_lines = "\n".join([f"{inner_tag}: {inner_content}" for inner_tag, inner_content in content.items()])
                    chunk_lines.append(f"{tag}:\n{inner_lines}")
                else:
                    chunk_lines.append(f"{tag}: {content}")

            chunk_text = "\n".join(chunk_lines)
            if chunk_text:
                chunks.append(Chunk.from_dict({
                    "content": chunk_text,
                    "metadata": {
                        "id": i
                    }
                }))

        return chunks

    def _load_markdown(
        self,
    ) -> List[Dict[str, str]]:
        html = markdown(self.doc)
        soup = BeautifulSoup(html, "html.parser")
        parsed_markdown = []

        for element in soup.find_all(True):
            tag = element.name
            content = element.get_text(strip=True)

            if tag.startswith("h"):
                parsed_markdown.append({"header": content})
            elif tag == "p":
                self._parse_paragraph(element, parsed_markdown)
            elif tag in ["ul", "ol"]:
                self._parse_list(element, parsed_markdown)
            elif tag == "blockquote":
                parsed_markdown.append({"blockquote": content})
            elif tag == "pre" or tag == "code":
                parsed_markdown.append({"code": content})

        return parsed_markdown

    def _parse_paragraph(
        self,
        element: BeautifulSoup,
        parsed_markdown: List[Dict[str, str]]
    ):
        parts = []
        for part in element.contents:
            if isinstance(part, str):
                if part.strip():
                    parts.append({"paragraph": part.strip()})
            else:
                inner_tag = part.name
                inner_content = part.get_text(strip=True)
                match inner_tag:
                    case "strong":
                        parts.append({"bold": inner_content})
                    case "em":
                        parts.append({"italic": inner_content})
                    case "a":
                        parts.append({"link": {"text": inner_content, "href": part.get("href")}})
                    case "code":
                        parts.append({"inline_code": inner_content})                


        for idx, part in enumerate(parts):
            if idx > 0 and "paragraph" in parts[idx - 1] and "paragraph" in parts[idx]:
                parts[idx - 1]["paragraph"] += f" {parts[idx]['paragraph']}"
            else:
                parsed_markdown.append(part)

    def _parse_list(
        self,
        element: BeautifulSoup,
        parsed_markdown: List[Dict[str, str]]
    ):
        for li in element.find_all("li"):
            parsed_markdown.append({"list_item": li.get_text(strip=True)})


class LengthChunking:
    def __init__(
        self, 
        doc: str
    ):
        self.doc = doc

    def chunk(
        self,
        sub_mode: str,
        extra_configs: dict
    ) -> str:
        match sub_mode.lower():
            case "size":
                chunk_size = extra_configs.get("chunk_size", 100)
                overlap = extra_configs.get("overlap", 0)
                handle_half_word = extra_configs.get("handle_half_word", False)
                split_chars = extra_configs.get("split_chars", None)
                return self.size_chunk(chunk_size, overlap, handle_half_word, split_chars)
            case "token":
                model_name = extra_configs.get("model_name", "bert-base-uncased")
                max_tokens = extra_configs.get("max_tokens", 200)
                return self.token_splitter(model_name, max_tokens)
            case _:
                raise ValueError("Unsupported Sub Chunking Mode for Length Chunk")

    @global_exception_handler(3102, "Error Executing Size-Chunk")
    def size_chunk(
        self, 
        chunk_size: int, 
        overlap: int = 0, 
        handle_half_word: bool = False, 
        split_chars: Optional[set[str]] = None
    ) -> List[Chunk]:
        """
        Generalized chunking method that can handle both strict and soft chunking based on parameters.
        """

        # Ensure space is always a split character
        split_chars = split_chars or {" ", ".", ",", ";", ":", "?", "!", "~"}
        split_chars.add(" ")

        chunks: List[Chunk] = []
        start_index = 0
        chunk_id = 0
        text_length = len(self.doc)

        while start_index < text_length:
            end_index = min(start_index + chunk_size, text_length)
            chunk_content = self.doc[max(0, start_index - overlap):end_index]
            remaining_text = self.doc[end_index:]

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

            chunks.append(Chunk.from_dict({
                "content": chunk_content.strip(),
                "metadata": {"id": chunk_id}
            }))
            chunk_id += 1
            start_index = end_index

        return chunks

    @global_exception_handler(3103, "Error Executing Token-Chunk")
    def token_splitter(
        self,
        model_name: str = "bert-base-uncased",
        max_tokens: int = 200
    ) -> List[Chunk]:
        """
        Splits text based on token count using a language model tokenizer.
        """

        tokenizer = AutoTokenizer.from_pretrained(model_name)
        tokens = tokenizer.tokenize(self.doc)

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
            Chunk.from_dict({
                "content": chunk,
                "metadata": {"id": i}
            }) for i, chunk in enumerate(chunks) if chunk.strip()
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
            previous_doc = self.doc[:start_index-overlap]
            split_index = [previous_doc.rfind(char) for char in split_chars]
            split_index = [index for index in split_index if index != -1]
            if split_index:
                max_split_index = max(split_index)
                chunk_content = previous_doc[max_split_index+1:] + chunk_content

        return chunk_content


class CharacterChunking:
    def __init__(
        self, 
        doc: str
    ):
        self.doc = doc

    def chunk(
        self,
        sub_mode: str,
        extra_configs: dict
    ) -> str:
        match sub_mode.lower():
            case "character":
                delimiters = extra_configs.get("delimiters", [",", ";"])
                return self.split_by_chars(delimiters)
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
        split_text = re.split(delimiter_pattern, self.doc)

        chunks = [
            Chunk.from_dict({
                "content": chunk.strip(),
                "metadata": {"id": i}})
            for i, chunk in enumerate(split_text) if chunk.strip()
        ]
        return chunks


class AdvancedChunking:
    def __init__(
        self, 
        doc: str
    ):
        self.doc = doc
        self.html_parser = "html.parser"

    def chunk(
        self,
        sub_mode: str,
        extra_configs: dict
    ) -> str:
        tags = extra_configs.get("tags", [])
        match sub_mode.lower():
            case "html":
                return self.html_splitter(tags)
            case "markdown":
                return self.markdown_splitter(tags)
            case _:
                raise ValueError("Unsupported Sub Chunking Mode for Advanced Chunk")

    @global_exception_handler(3105, "Error Executing HTML-Chunk")
    def html_splitter(
        self,
        tags: List[Tuple[str, str]] = None
    ) -> List[Chunk]:
        """
        Splits an HTML document based on user-specified tags and stores tag names in the metadata.
        If no tags are specified, splits by all tags.
        """

        soup = BeautifulSoup(self.doc, self.html_parser)
        tags = tags or [(tag.name, tag.name) for tag in soup.find_all()]

        chunks = []
        i = 0
        for tag_name, tag_label in tags:
            for element in soup.find_all(tag_name):
                content = element.get_text(strip=True)
                if content:
                    chunks.append(Chunk.from_dict({
                        "content": content,
                        "metadata": {"id": i, tag_label: element.name}
                    }))
                    i += 1

        return chunks

    @global_exception_handler(3106, "Error Executing Markdown-Chunk")
    def markdown_splitter(
        self,
        tags: List[Tuple[str, str]] = None
    ) -> List[Chunk]:
        """
        Splits a Markdown document based on user-specified tags and stores tag names in the metadata.
        If no tags are specified, splits by all markdown symbols.
        """

        # Convert markdown to HTML
        html_content = markdown(self.doc)

        # Parse HTML content
        soup = BeautifulSoup(html_content, self.html_parser)

        # Use all available tags if no specific tags are provided
        if not tags:
            tags = [(tag.name, tag.name) for tag in soup.find_all()]

        chunks = []
        i = 0
        for tag_name, tag_label in tags:
            for element in soup.find_all(tag_name):
                content = element.get_text(strip=True)
                if content:
                    chunks.append(Chunk.from_dict({
                        "content": content,
                        "metadata": {"id": i, tag_label: tag_name}
                    }))
                    i += 1

        return chunks


class SpecialChunking:
    def __init__(
        self, 
        doc: str
    ):
        self.doc = doc

    def chunk(
        self,
        sub_mode: str,
        extra_configs: dict
    ) -> str:
        match sub_mode.lower():
            case "recursive":
                max_length = extra_configs.get("extra_configs", 200)
                return self.recursive_text_splitter(max_length)
            case "semantic":
                docs = extra_configs.get("docs", [])
                embeddings = extra_configs.get("embeddings", [])
                threshold = extra_configs.get("threshold", 0.75)
                top_k = extra_configs.get("top_k", None)
                return self.semantic_chunk(docs, embeddings, threshold, top_k)
            case _:
                raise ValueError("Unsupported Sub Chunking Mode for Special Chunk")

    @global_exception_handler(3108, "Error Executing Recursive-Chunk")
    def recursive_text_splitter(
        self,
        max_length: int = 200,
    ) -> List[Chunk]:
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

        split_chunks = split_recursively(self.doc)
        chunks = [
            Chunk.from_dict({
                "content": chunk,
                "metadata": {"id": i}}) 
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
    ) -> List[Chunk]:
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
            Chunk.from_dict({
                "content": "".join(doc_list),
                "metadata": {
                    "id": chunk_id
                }
            }) for chunk_id, doc_list in enumerate(chunks) if doc_list
        ]

        return chunks


class LLMChunking:
    def __init__(
        self, 
        doc: str
    ):
        self.doc = doc

    def chunk(
        self,
        sub_mode: str,
        extra_configs: dict
    ) -> str:
        match sub_mode.lower():
            case "llm":
                prompt = extra_configs.get("prompt", None)
                model = extra_configs.get("model", "gpt-4o")
                return self.llm_chunk(prompt, model)
            case _:
                raise ValueError("Unsupported Sub Chunking Mode for LLM Chunk")

    @global_exception_handler(3109, "Error Executing LLM-Chunk")
    def llm_chunk(
        self,
        prompt: str = None,
        model: str = "gpt-4o"
    ):
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
            {"role": "user", "content": f"The original document: {self.doc}"}
        ]

        # Call to the LLM chat function
        response = lite_llm_chat(
            messages=messages,
            model=model,
            temperature=0.7,
            max_tokens=4096,
            printing=False,
            stream=False,
            response_format={"type": "json_object"},
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


class ChunkingFactory:
    @staticmethod
    @global_exception_handler(3100, "Error Initializing Chunking Method")
    def create_chunking(
        chunking_mode: str,
        sub_mode: str,
        doc: str,
        extra_configs: dict
    ) -> List[str]:
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

        chunker = chunking_class(doc)
        chunks = chunker.chunk(sub_mode, extra_configs)
        return chunks


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
    print("Auto Chunking -- Text: ", ChunkingFactory.create_chunking("auto", "text", doc))

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
    print("Auto Chunking -- JSON 1: ", ChunkingFactory.create_chunking("auto", "json", json_input))
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
    print("Auto Chunking -- JSON 2: ", ChunkingFactory.create_chunking("auto", "json", json_input))
    json_input = [{
    "name": "John",
    "age": 30,
    "address": {
        "street": "123 Main St",
        "city": "New York"
    },
    "phones": ["123-4567", "234-5678"]
}]
    print("Auto Chunking -- JSON list: ", ChunkingFactory.create_chunking("auto", "json", json_input))
    
    markdown_input = """
# Header 1
## Header 2
This is some **bold text** and some *italic text*.
Here is a [link](https://example.com) and some `inline code`.

- Item 1
- Item 2
* A
* B

> This is a blockquote

```
This is a block of code
```
    """
    print("Auto Chunking -- MarkDown: ", ChunkingFactory.create_chunking("auto", "markdown", markdown_input))
    
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
