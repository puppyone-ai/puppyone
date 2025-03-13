# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import os
import re
import json
import base64
import easyocr
import whisper
import pypandoc
import requests
import pymupdf4llm
import pandas as pd
from Utils.puppy_exception import puppy_exception, global_exception_handler


class FileToTextParser:
    """
    A class to parse various file types into text or structured data.

    Attributes:
        root_path (str): The root directory path where files are located.
        file_path (str): The full path of the file to be parsed.
    """

    def __init__(
        self,
        root_path: str,
    ):
        """
        Initializes the FileToTextParser with the given root path.

        Args:
            root_path (str): The root directory path where files are located.
        """

        self.root_path = root_path
        self.file_path = root_path
        pandoc_path = pypandoc.get_pandoc_path()
        if not (pandoc_path and os.path.exists(pandoc_path)):
            pypandoc.download_pandoc()

    def parse(
        self,
        file_name: str,
        file_type: str,
        **kwargs
    ) -> str:
        """
        Parses the given file based on its type.
        
        Args:
            file_name (str): The name of the file to be parsed.
            file_type (str): The type of the file (e.g., 'json', 'txt', 'markdown').
            **kwargs: Additional keyword arguments for specific parsing methods.

        Returns:
            str: The parsed content of the file.

        Raises:
            puppy_exception: If the file type is unsupported.
        """

        self.file_path = os.path.join(self.root_path, file_name)
        file_type = file_type.lower()
        method_name = f"_parse_{file_type}"
        parse_method = getattr(self, method_name, None)
        if not parse_method:
            raise puppy_exception(1301, "Unsupported File Type")
        return parse_method(**kwargs)

    @global_exception_handler(1302, "Error Parsing JSON File")
    def _parse_json(
        self,
        **kwargs
    ) -> dict:
        """
        Parses a JSON file and returns its content as a dictionary.

        Args:
            **kwargs: No additional arguments are expected.

        Returns:
            dict: The parsed JSON content.

        Raises:
            puppy_exception: If any additional arguments are provided.
        """

        if kwargs:
            raise ValueError("There should not be any parameters for parsing JSON File!")

        with open(self.file_path, "r", encoding="utf-8") as f:
            content = f.read()

            if kwargs.get("keep_json", True):
                content = json.loads(content)
        return content

    @global_exception_handler(1303, "Error Parsing TXT File")
    def _parse_txt(
        self,
        **kwargs
    ) -> str:
        """
        Parses a TXT file and returns its content as a string.

        Args:
            **kwargs: Additional arguments for specific parsing options.
            - auto_formatting (bool): Whether to remove extra whitespaces and newlines.

        Returns:
            str: The parsed TXT content.
        """

        with open(self.file_path, "r", encoding="utf-8") as f:
            content = f.read()

        if kwargs.get("auto_formatting", False):
            content = re.sub(r"\s+", " ", content)

        return content

    @global_exception_handler(1304, "Error Parsing MARKDOWN File")
    def _parse_markdown(
        self,
        **kwargs
    ) -> str:
        """
        Parses a Markdown file and returns its content as a string.

        Args:
            **kwargs: Additional arguments for specific parsing options.
            - auto_formatting (bool): Whether to remove extra whitespaces and newlines.

        Returns:
            str: The parsed Markdown content.
        """

        with open(self.file_path, "r", encoding="utf-8") as file:
            markdown_content = file.read()

        if kwargs.get("auto_formatting", False):
            markdown_content = self._remove_markdown_syntax(markdown_content)

        return markdown_content

    @global_exception_handler(1312, "Error Removing Markdown Syntax")
    def _remove_markdown_syntax(
        self,
        markdown_text: str
    ) -> str:
        """
        Removes Markdown syntax from the given text.

        Args:
            markdown_text (str): The Markdown text to be cleaned.

        Returns:
            str: The text with Markdown syntax removed.
        """

        # Capture Markdown syntax
        patterns = [
            (r"#(\s*)", ""), (r"\*\*(.*?)\*\*", r"\1"), (r"__(.*?)__", r"\1"),
            (r"\*(.*?)\*", r"\1"), (r"_(.*?)_", r"\1"), (r"~~(.*?)~~", r"\1"),
            (r"`([^`]*)`", r"\1"), (r"\[(.*?)\]\((.*?)\)", r"\1"),
            (r"!\[(.*?)\]\((.*?)\)", r"\1"), (r"^\s*>", "", re.MULTILINE),
            (r"^\s*[-*+]\s+", "", re.MULTILINE), (r"^\s*\d+\.\s+", "", re.MULTILINE),
            (r"<[^>]+>", "")
        ]
        for pattern, repl, *flags in patterns:
            markdown_text = re.sub(pattern, repl, markdown_text, flags=flags[0] if flags else 0)
        return markdown_text.strip()

    @global_exception_handler(1305, "Error Parsing DOC File")
    def _parse_doc(
        self,
        **kwargs
    ) -> str:
        """
        Parses a DOCX file and returns its content as a string.

        Args:
            **kwargs: Additional arguments for specific parsing options.
            - auto_formatting (bool): Whether to remove extra whitespaces and newlines.

        Returns:
            str: The parsed CSV content.

        Supported file types:
        biblatex, bibtex, bits, commonmark, commonmark_x, creole, csljson, csv, 
        djot, docbook, docx, dokuwiki, endnotexml, epub, fb2, gfm, haddock, html, 
        ipynb, jats, jira, json, latex, man, markdown, markdown_github, markdown_mmd, 
        markdown_phpextra, markdown_strict, mediawiki, muse, native, odt, opml, org, 
        ris, rst, rtf, t2t, textile, tikiwiki, tsv, twiki, typst, vimwiki
        """

        output = pypandoc.convert_file(self.file_path, "markdown")

        output = output.replace('\\"', '"').replace("\\'", "'")

        if kwargs.get("auto_formatting", False):
            output = re.sub(r"\s+", " ", output)

        return output

    @global_exception_handler(1306, "Error Parsing PDF File")
    def _parse_pdf(
        self,
        **kwargs
    ) -> str:
        """
        Parses a PDF file and returns its content as a string.

        Args:
            **kwargs: Additional arguments for specific parsing options.
            - use_images (bool): Whether to extract images from the PDF and apply OCR.
            - pages (list): The list of page numbers to parse.

        Returns:
            str: The parsed PDF content.
        """

        pdf_content = ""
        use_images = kwargs.get("use_images", False)
        pages = kwargs.get("pages", None)
        if pages is not None and not isinstance(pages, list):
            raise ValueError("Pages must be a list of integers!")

        pdf_content = pymupdf4llm.to_markdown(self.file_path, pages=pages, write_images=use_images)

        return pdf_content

    @global_exception_handler(1313, "Error in OCR Image")
    def _ocr_image(
        self,
        image_path: str,
        language_list: list = None
    ) -> str:
        """
        Use OCR to extract text from an image.

        Args:
            image_path (str): The path to the image file.
            language_list (list): The list of languages to use for OCR.

        Returns:
            str: The extracted image text.
        """

        language_list = language_list if language_list else ["ch_sim", "en"]
        reader = easyocr.Reader(language_list)
        result = reader.readtext(image_path)
        texts_in_img = "\n".join([text[1] for text in result])
        return texts_in_img

    @global_exception_handler(1309, "Error Parsing Image")
    def _parse_image(
        self,
        **kwargs
    ) -> str:
        """
        Parsing the image file using either OCR or LLM description.

        Args:
            **kwargs: Additional arguments for specific parsing options.
            - use_llm (bool): Whether to use LLM for describing the image.

        Returns:
            str: The parsed image content.
        """

        use_llm = kwargs.get("use_llm", False)
        if use_llm:
            with open(self.file_path, "rb") as image_file:
                base64_image = base64.b64encode(image_file.read()).decode("utf-8")
            description = self._describe_image_with_llm(base64_image)
            return description
        return self._ocr_image(self.file_path)

    @global_exception_handler(1310, "Error Parsing Audio")
    def _parse_audio(
        self,
        **kwargs
    ) -> str:
        """
        Parsing the audio file and transcribing it using whisper.

        Args:
            **kwargs: Additional arguments for specific parsing options.
            - mode (str): The mode of the whisper model. Either "base" or "accurate".

        Returns:
            str: The parsed audio content.
        """

        mode = kwargs.get("mode", "accurate")
        model = whisper.load_model("small" if mode == "accurate" else "base")
        result = model.transcribe(self.file_path)
        return result["text"]

    @global_exception_handler(1311, "Error Parsing Video")
    def _parse_video(
        self,
        **kwargs
    ) -> str:
        """
        Parsing the video file and describing each frame using LLM.

        Args:
            **kwargs: Additional arguments for specific parsing options.
            - use_llm (bool): Whether to use LLM for describing each frame.
            - frame_skip (int): The number of frames to skip between descriptions.

        Returns:
            str: The parsed video content.
        """

        use_llm = kwargs.get("use_llm", False)
        if use_llm:
            skip_num = kwargs.get("frame_skip", 30)
            return self._describe_video_with_llm(skip_num)
        else:
            return self._parse_audio(split_speakers=False)

    @global_exception_handler(1307, "Error Parsing CSV File")
    def _parse_csv(
        self,
        **kwargs
    ) -> str:
        """
        Parses a CSV file and returns its content as a string.

        Args:
            **kwargs: Additional arguments for specific parsing options.
            - column_range (list): The range of columns to parse. In form of [start, end].
            - row_range (list): The range of rows to parse. In form of [start, end].
        Returns:
            str: The parsed CSV content.
        """

        column_range = kwargs.get("column_range", None)
        row_range = kwargs.get("row_range", None)
        if (column_range and not isinstance(column_range, list)) or (row_range and not isinstance(row_range, list)):
            raise ValueError("Column range and row range should be lists of integers!")

        df = pd.read_csv(self.file_path)
        if column_range:
            df = df.iloc[:, column_range[0]:column_range[1]]
        if row_range:
            df = df.iloc[row_range[0]:row_range[1]]
        return df.to_csv(index=False)

    @global_exception_handler(1308, "Error Parsing XLSX File")
    def _parse_xlsx(
        self,
        **kwargs
    ) -> str:
        """
        Parses an XLSX file and returns its content as a string.

        Args:
            **kwargs: Additional arguments for specific parsing options.
            - column_range (list): The range of columns to parse. In form of [start, end].
            - row_range (list): The range of rows to parse. In form of [start, end].

        Returns:
            str: The parsed XLSX content.
        """

        column_range = kwargs.get("column_range", None)
        row_range = kwargs.get("row_range", None)
        if (column_range and not isinstance(column_range, list)) or (row_range and not isinstance(row_range, list)):
            raise ValueError("Column range and row range should be lists of integers!")

        df = pd.read_excel(self.file_path)
        if column_range:
            df = df.iloc[:, column_range[0]:column_range[1]]
        if row_range:
            df = df.iloc[row_range[0]:row_range[1]]

        return df.to_csv(index=False)

    @global_exception_handler(1314, "Error Describing Image")
    def _describe_image_with_llm(
        self,
        base64_image: str
    ) -> str:
        """
        Describes an image using the LLM model.

        Args:
            base64_image (str): The base64 encoded image.

        Returns:
            str: The description of the image.
        """

        api_key = os.environ.get("OPENAI_API_KEY")

        headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
        }

        payload = {
            "model": "gpt-4o",
            "messages": [
                {
                "role": "user",
                "content": [
                    {
                    "type": "text",
                    "text": "Describe the following image in detail."
                    },
                    {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{base64_image}"
                    }
                    }
                ]
                }
            ],
            "max_tokens": 1000
        }

        response = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers=headers,
            json=payload
        )

        return response.json()["choices"][0]["message"]["content"]

    @global_exception_handler(1315, "Error Describing Video")
    def _describe_video_with_llm(
        self,
        skip_num: int = 30
    ) -> str:
        # Need to use VLM in the future
        return f"Video Description with LLM (Frame Skip: {skip_num})"


if __name__ == "__main__":
    import os
    from dotenv import load_dotenv

    # Load environment variables
    load_dotenv()

    file_root_path = "PuppyEngine/Blocks/testfiles"
    parser = FileToTextParser(file_root_path)
    parsed_content = parser.parse("testjson.json", "json")
    print(f"JSON Parsed Content:\n{parsed_content}\n", parsed_content.get("Name"))

    parsed_content = parser.parse("testtxt.txt", "txt", auto_formatting=False)
    print(f"TXT Parsed Content:\n{parsed_content}\n")

    parsed_content = parser.parse("testmd.md", "markdown", auto_formatting=True)
    print(f"Markdown Parsed Content:\n{parsed_content}\n")

    parsed_content = parser.parse("testdoc.docx", "doc", auto_formatting=False)
    print(f"DOCX Parsed Content:\n{parsed_content}\n")

    parsed_content = parser.parse("testpdf.pdf", "pdf", use_images=True)
    print(f"PDF Parsed Content:\n{parsed_content}\n")

    parsed_content = parser.parse("testimg.png", "image", use_llm=False)
    print(f"Image Parsed Content:\n{parsed_content}\n")
    parsed_content = parser.parse("testimg2.png", "image", use_llm=True)
    print(f"Image Parsed Content 2:\n{parsed_content}\n")

    parsed_content = parser.parse("testaudio.mp3", "audio", mode="accurate")
    print(f"Audio Parsed Content:\n{parsed_content}\n")

    parsed_content = parser.parse("testvideo.mp4", "video", use_llm=True, frame_skip=300)
    print(f"Video Parsed Content:\n{parsed_content}\n")
    parsed_content = parser.parse("testvideo2.mp4", "video", use_llm=False)
    print(f"Video Parsed Content 2:\n{parsed_content}\n")

    parsed_content = parser.parse("testcsv.csv", "csv", column_range=[0, 3], row_range=[0, 5])
    print(f"CSV Parsed Content:\n{parsed_content}\n")

    parsed_content = parser.parse("testxlsx.xlsx", "xlsx", column_range=[0, 3], row_range=[0, 5])
    print(f"XLSX Parsed Content:\n{parsed_content}\n")
