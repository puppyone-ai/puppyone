# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from typing import List, Dict, Tuple
from bs4 import BeautifulSoup
from markdown2 import markdown
from DataClass.Chunk import Chunk
from ModularEdges.ChunkEdge.base_chunk import BaseChunk
from Utils.PuppyEngineExceptions import global_exception_handler


class AdvancedChunking(BaseChunk):
    def __init__(
        self, 
        documents: str
    ):
        super().__init__(documents)
        self.html_parser = "html.parser"

    def chunk(
        self,
        sub_mode: str,
        extra_configs: dict
    ) -> List[Chunk]:
        tags = extra_configs.get("tags", [])
        match sub_mode.lower():
            case "html":
                return self.list_to_chunks(self.html_splitter(tags))
            case "markdown":
                return self.list_to_chunks(self.markdown_splitter(tags))
            case "markdown_structured":
                return self.list_to_chunks(self.chunk_markdown())
            case _:
                raise ValueError("Unsupported Sub Chunking Mode for Advanced Chunk")

    @global_exception_handler(3105, "Error Executing HTML-Chunk")
    def html_splitter(
        self,
        tags: List[Tuple[str, str]] = None
    ) -> List[Dict[str, str]]:
        """
        Splits an HTML document based on user-specified tags and stores tag names in the metadata.
        If no tags are specified, splits by all tags.
        """

        soup = BeautifulSoup(self.documents, self.html_parser)
        tags = tags or [(tag.name, tag.name) for tag in soup.find_all()]

        chunks = []
        i = 0
        for tag_name, tag_label in tags:
            for element in soup.find_all(tag_name):
                content = element.get_text(strip=True)
                if content:
                    chunks.append({
                        "content": content,
                        "metadata": {"id": i, tag_label: element.name}
                    })
                    i += 1

        return chunks

    @global_exception_handler(3106, "Error Executing Markdown-Chunk")
    def markdown_splitter(
        self,
        tags: List[Tuple[str, str]] = None
    ) -> List[Dict[str, str]]:
        """
        Splits a Markdown document based on user-specified tags and stores tag names in the metadata.
        If no tags are specified, splits by all markdown symbols.
        """

        # Convert markdown to HTML
        html_content = markdown(self.documents)

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
                    chunks.append({
                        "content": content,
                        "metadata": {"id": i, tag_label: tag_name}
                    })
                    i += 1

        return chunks

    def chunk_markdown(
        self
    ) -> List[Dict[str, str]]:
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
                chunks.append({
                    "content": chunk_text,
                    "metadata": {
                        "id": i
                    }
                })

        return chunks

    def _load_markdown(
        self,
    ) -> List[Dict[str, str]]:
        html = markdown(self.documents)
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


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

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
    print("HTML Splitter with user-specified tags:")
    print(AdvancedChunking(sample_html).chunk(sub_mode="html", extra_configs={"tags": [("h1", "Header 1"), ("h2", "Header 2")]}))
    print("\nHTML Splitter with default tags:")
    print(AdvancedChunking(sample_html).chunk(sub_mode="html", extra_configs={}))
    print("\nMarkdown Splitter with user-specified tags:")
    print(AdvancedChunking(sample_markdown).chunk(sub_mode="markdown", extra_configs={"tags": [("h1", "Header 1"), ("h2", "Header 2")]}))
    print("\nMarkdown Splitter with default tags:")
    print(AdvancedChunking(sample_markdown).chunk(sub_mode="markdown", extra_configs={}))
    print("\nMarkdown Structured Chunk:")
    print(AdvancedChunking(sample_markdown).chunk(sub_mode="markdown_structured", extra_configs={}))
