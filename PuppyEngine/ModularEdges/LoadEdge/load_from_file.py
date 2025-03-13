# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import io
import os
import re
import json
import base64
import threading
import pymupdf
import easyocr
import whisper
import pypandoc
import requests
import pymupdf4llm
import numpy as np
import pandas as pd
import concurrent.futures
from pydub import AudioSegment
from typing import List, Dict, Any
from Utils.PuppyEngineExceptions import PuppyEngineException, global_exception_handler


class FileToTextParser:
    """
    A class to parse various file types into text or structured data.

    Attributes:
        root_path (str): The root directory path where files are located.
        file_path (str): The full path of the file to be parsed.
    """

    def __init__(
        self,
    ):
        """
        Initializes the FileToTextParser.
        """

        # 初始化各种锁
        self._pandoc_lock = threading.Lock()
        self._ocr_lock = threading.Lock()
        self._whisper_lock = threading.Lock()
        self._audio_lock = threading.Lock()
        
        # 预加载模型和资源
        try:
            self._whisper_model = None  # 延迟加载
            self._ocr_reader = None     # 延迟加载
            
            # pandoc 检查
            pandoc_path = pypandoc.get_pandoc_path()
            if not (pandoc_path and os.path.exists(pandoc_path)):
                pypandoc.download_pandoc()
        except Exception:
            pypandoc.download_pandoc()

    def _get_whisper_model(self, mode: str):
        """懒加载 whisper 模型"""
        if self._whisper_model is None:
            with self._whisper_lock:
                if self._whisper_model is None:
                    self._whisper_model = whisper.load_model(
                        "small" if mode == "accurate" else "base"
                    )
        return self._whisper_model

    def _get_ocr_reader(self, language_list: list = None):
        """懒加载 OCR reader"""
        if self._ocr_reader is None:
            with self._ocr_lock:
                if self._ocr_reader is None:
                    language_list = language_list if language_list else ["ch_sim", "en"]
                    self._ocr_reader = easyocr.Reader(language_list)
        return self._ocr_reader

    @global_exception_handler(1302, "Error Parsing Multiple Files")
    def parse_multiple(
        self,
        file_configs: List[Dict[str, Any]]
    ) -> List[Any]:
        """
        Parse multiple files concurrently with different configurations.

        Args:
            file_configs: List of file configurations, where each configuration is a dict with:
                - file_path: Path or URL to the file
                - file_type: Type of the file (json, pdf, etc.)
                - config: Dict of parsing parameters specific to this file

        Returns:
            List of parsed file contents in the same order as the input configurations

        Raises:
            PuppyEngineException: If parsing any file fails
        """

        results = []

        with concurrent.futures.ThreadPoolExecutor() as executor:
            future_to_index = {}
            for i, file_config in enumerate(file_configs):
                file_path = file_config.get('file_path')
                file_type = file_config.get('file_type').lower() or self._determine_file_type(file_path)
                config = file_config.get('config', {})

                future = executor.submit(self.parse, file_path, file_type, **config)
                future_to_index[future] = i

            # Collect results as they complete
            results = [None] * len(file_configs)
            for future in concurrent.futures.as_completed(future_to_index):
                idx = future_to_index[future]
                try:
                    results[idx] = future.result()
                except Exception as e:
                    # Store error in results list
                    results[idx] = {"error": str(e)}

        return results

    @global_exception_handler(1317, "Error Determining File Type")
    def _determine_file_type(
        self,
        file_path: str
    ) -> str:
        """
        Determine file type from file extension.

        Args:
            file_path: Path or URL to the file

        Returns:
            File type based on extension
        """

        _, ext = os.path.splitext(file_path)
        ext = ext.lower().lstrip('.')

        extension_map = {
            'json': 'json',
            'txt': 'txt',
            'md': 'markdown',
            'pdf': 'pdf',
            'doc': 'doc',
            'docx': 'doc',
            'csv': 'csv',
            'xlsx': 'xlsx',
            'xls': 'xlsx',
            'jpg': 'image',
            'jpeg': 'image',
            'png': 'image',
            'gif': 'image',
            'mp3': 'audio',
            'wav': 'audio',
            'mp4': 'video',
            'avi': 'video',
            'mov': 'video'
        }

        file_type = extension_map.get(ext)
        if not file_type:
            raise PuppyEngineException(1305, "Unknown File Type", f"Cannot determine file type for extension: {ext}")

        return file_type

    def parse(
        self,
        file_path: str,
        file_type: str,
        **kwargs
    ) -> str:
        """
        Parses the given file based on its type.
        
        Args:
            file_path (str): The path to the file to be parsed.
            file_type (str): The type of the file to be parsed.
            **kwargs: Additional keyword arguments for specific parsing methods.

        Returns:
            str: The parsed content of the file.

        Raises:
            PuppyEngineException: If the file type is unsupported.
        """

        method_name = f"_parse_{file_type}"
        parse_method = getattr(self, method_name, None)
        if not parse_method:
            raise PuppyEngineException(1301, "Unsupported File Type")
        return parse_method(file_path, **kwargs)

    @global_exception_handler(1316, "Error Parsing Remote File")
    def _remote_file_to_byte_io(
        self,
        file_url: str
    ) -> io.BytesIO:
        """
        Converts a remote file to a BytesIO object.

        Args:
            file_url (str): The URL of the remote file.

        Returns:
            io.BytesIO: The BytesIO object of the remote file.
        """

        response = requests.get(file_url)
        return io.BytesIO(response.content)

    def _is_file_url(
        self,
        file_url: str
    ) -> bool:
        """
        Checks if the given URL is a file URL.
        """

        return file_url.startswith("http://") or file_url.startswith("https://")

    @global_exception_handler(1302, "Error Parsing JSON File")
    def _parse_json(
        self,
        file_path: str,
        **kwargs
    ) -> dict:
        """
        Parses a JSON file and returns its content as a dictionary.

        Args:
            file_path (str): The path to the file to be parsed.
            **kwargs: No additional arguments are expected.

        Returns:
            dict: The parsed JSON content.

        Raises:
            PuppyEngineException: If any additional arguments are provided.
        """

        if kwargs:
            raise ValueError("There should not be any parameters for parsing JSON File!")

        content = ""
        if self._is_file_url(file_path):
            file_bytes = self._remote_file_to_byte_io(file_path)
            content = file_bytes.read().decode('utf-8')
        else:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()

            if kwargs.get("keep_json", True):
                content = json.loads(content)
        return content

    @global_exception_handler(1303, "Error Parsing TXT File")
    def _parse_txt(
        self,
        file_path: str,
        **kwargs
    ) -> str:
        """
        Parses a TXT file and returns its content as a string.

        Args:
            file_path (str): The path to the file to be parsed.
            **kwargs: Additional arguments for specific parsing options.
            - auto_formatting (bool): Whether to remove extra whitespaces and newlines.

        Returns:
            str: The parsed TXT content.
        """

        content = ""
        if self._is_file_url(file_path):
            file_bytes = self._remote_file_to_byte_io(file_path)
            content = file_bytes.read().decode('utf-8')
        else:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()

        if kwargs.get("auto_formatting", False):
            content = re.sub(r"\s+", " ", content)

        return content

    @global_exception_handler(1304, "Error Parsing MARKDOWN File")
    def _parse_markdown(
        self,
        file_path: str,
        **kwargs
    ) -> str:
        """
        Parses a Markdown file and returns its content as a string.

        Args:
            file_path (str): The path to the file to be parsed.
            **kwargs: Additional arguments for specific parsing options.
            - auto_formatting (bool): Whether to remove extra whitespaces and newlines.

        Returns:
            str: The parsed Markdown content.
        """

        content = ""
        if self._is_file_url(file_path):
            file_bytes = self._remote_file_to_byte_io(file_path)
            content = file_bytes.read().decode('utf-8')
        else:
            with open(file_path, "r", encoding="utf-8") as file:
                content = file.read()

        if kwargs.get("auto_formatting", False):
            content = self._remove_markdown_syntax(content)

        return content

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
        file_path: str,
        **kwargs
    ) -> str:
        """
        Parses a DOCX file and returns its content as a string.

        Args:
            file_path (str): The path to the file to be parsed.
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

        source_file = file_path
        if self._is_file_url(file_path):
            source_file_request = requests.get(file_path)
            source_file = source_file_request.content

        output = pypandoc.convert_file(source_file, "markdown")

        output = output.replace('\\"', '"').replace("\\'", "'")

        if kwargs.get("auto_formatting", False):
            output = re.sub(r"\s+", " ", output)

        return output

    @global_exception_handler(1306, "Error Parsing PDF File")
    def _parse_pdf(
        self,
        file_path: str,
        **kwargs
    ) -> str:
        """
        Parses a PDF file and returns its content as a string.

        Args:
            file_path (str): The path to the file to be parsed.
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

        # 确保每个线程使用独立的 PDF 对象
        if self._is_file_url(file_path):
            file_object = self._remote_file_to_byte_io(file_path)
            with pymupdf.open(stream=file_object, filetype='pdf') as pdf:
                pdf_content = pymupdf4llm.to_markdown(pdf, pages=pages, write_images=use_images)
        else:
            with pymupdf.open(file_path) as pdf:
                pdf_content = pymupdf4llm.to_markdown(pdf, pages=pages, write_images=use_images)

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
        reader = self._get_ocr_reader(language_list)
        with self._ocr_lock:
            result = reader.readtext(image_path)
        return "\n".join([text[1] for text in result])

    @global_exception_handler(1309, "Error Parsing Image")
    def _parse_image(
        self,
        file_path: str,
        **kwargs
    ) -> str:
        """
        Parsing the image file using either OCR or LLM description.

        Args:
            file_path (str): The path to the image file to be parsed.
            **kwargs: Additional arguments for specific parsing options.
            - use_llm (bool): Whether to use LLM for describing the image.

        Returns:
            str: The parsed image content.
        """

        use_llm = kwargs.get("use_llm", False)
        if use_llm:
            image = file_path
            if not self._is_file_url(file_path):
                with open(file_path, "rb") as image_file:
                    image = base64.b64encode(image_file.read()).decode("utf-8")
                    image = f"data:image/jpeg;base64,{image}"
            description = self._describe_image_with_llm(image)
            return description

        return self._ocr_image(file_path)

    @global_exception_handler(1310, "Error Parsing Audio")
    def _parse_audio(
        self,
        file_path: str,
        **kwargs
    ) -> str:
        """
        Parsing the audio file and transcribing it using whisper.

        Args:
            file_path (str): The path to the audio file to be parsed.
            **kwargs: Additional arguments for specific parsing options.
            - mode (str): The mode of the whisper model. Either "base" or "accurate".

        Returns:
            str: The parsed audio content.
        """

        mode = kwargs.get("mode", "accurate")
        model = self._get_whisper_model(mode)
        
        with self._audio_lock:
            samples = file_path
            if self._is_file_url(file_path):
                audio_bytes = self._remote_file_to_byte_io(file_path)
                audio = AudioSegment.from_file(audio_bytes, format="mp3")
                audio = audio.set_channels(1).set_frame_rate(16000)
                samples = np.array(audio.get_array_of_samples()).astype(np.float32) / 32768.0

            result = model.transcribe(samples)
        return result["text"]

    @global_exception_handler(1311, "Error Parsing Video")
    def _parse_video(
        self,
        file_path: str,
        **kwargs
    ) -> str:
        """
        Parsing the video file and describing each frame using LLM.

        Args:
            file_path (str): The path to the video file to be parsed.
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
            return self._parse_audio(file_path, split_speakers=False)

    @global_exception_handler(1307, "Error Parsing CSV File")
    def _parse_csv(
        self,
        file_path: str,
        **kwargs
    ) -> str:
        """
        Parses a CSV file and returns its content as a string.

        Args:
            file_path (str): The path to the CSV file to be parsed.
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

        csv_file = file_path
        if self._is_file_url(file_path):
            csv_file = self._remote_file_to_byte_io(file_path)

        df = pd.read_csv(csv_file)
        if column_range:
            df = df.iloc[:, column_range[0]:column_range[1]]
        if row_range:
            df = df.iloc[row_range[0]:row_range[1]]
        return df.to_csv(index=False)

    @global_exception_handler(1308, "Error Parsing XLSX File")
    def _parse_xlsx(
        self,
        file_path: str,
        **kwargs
    ) -> str:
        """
        Parses an XLSX file and returns its content as a string.

        Args:
            file_path (str): The path to the XLSX file to be parsed.
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

        xlsx_file = file_path
        if self._is_file_url(file_path):
            xlsx_file = self._remote_file_to_byte_io(file_path)

        df = pd.read_excel(xlsx_file)
        if column_range:
            df = df.iloc[:, column_range[0]:column_range[1]]
        if row_range:
            df = df.iloc[row_range[0]:row_range[1]]

        return df.to_csv(index=False)

    @global_exception_handler(1314, "Error Describing Image")
    def _describe_image_with_llm(
        self,
        image: str
    ) -> str:
        """
        Describes an image using the LLM model.

        Args:
            image (str): The base64 encoded image or image url.

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
                            "url": image
                        }
                    }
                ]
                }
            ],
            "max_tokens": 1024
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

    file_root_path = "ModularEdges/LoadEdge/testfiles"
    file_configs = [
        {
            "file_path": os.path.join(file_root_path, "testjson.json"),
            "file_type": "json"
        },
        {
            "file_path": os.path.join(file_root_path, "testtxt.txt"),
            "file_type": "txt",
            "config": {
                "auto_formatting": False
            }
        },
        {
            "file_path": os.path.join(file_root_path, "testmd.md"),
            "file_type": "markdown",
            "config": {
                "auto_formatting": True
            }
        },
        {
            "file_path": os.path.join(file_root_path, "testdoc.docx"),
            "file_type": "doc",
            "config": {
                "auto_formatting": False
            }
        },
        {
            "file_path": os.path.join(file_root_path, "testpdf.pdf"),
            "file_type": "pdf",
            "config": {
                "use_images": True
            }
        },
        {
            "file_path": os.path.join(file_root_path, "testimg.png"),
            "file_type": "image",
            "config": {
                "use_llm": False
            }
        },
        {
            "file_path": os.path.join(file_root_path, "testimg2.png"),
            "file_type": "image",
            "config": {
                "use_llm": True
            }
        },
        {
            "file_path": os.path.join(file_root_path, "testaudio.mp3"),
            "file_type": "audio",
            "config": {
                "mode": "accurate"
            }
        },
        {
            "file_path": os.path.join(file_root_path, "testvideo.mp4"),
            "file_type": "video",
            "config": {
                "use_llm": True,
                "frame_skip": 300
            }
        },
        {
            "file_path": os.path.join(file_root_path, "testvideo2.mp4"),
            "file_type": "video",
            "config": {
                "use_llm": False
            }
        },
        {
            "file_path": os.path.join(file_root_path, "testcsv.csv"),
            "file_type": "csv",
            "config": {
                "column_range": [0, 3],
                "row_range": [0, 5]
            }
        },  
        {
            "file_path": os.path.join(file_root_path, "testxlsx.xlsx"),
            "file_type": "xlsx",
            "config": {
                "column_range": [0, 3],
                "row_range": [0, 5]
            }
        },
        {
            "file_path": "https://docs.google.com/document/d/1WUODFdt78C1l4ncx2LLqnPoWOohyWxUN6f_Y1GO69UM/export?format=docx",
            "file_type": "doc",
            "config": {
                "auto_formatting": True
            }
        },
        {
            "file_path": "https://www.ntu.edu.sg/docs/librariesprovider118/pg/msai-ay2024-2025-semester-2-timetable.pdf",
            "file_type": "pdf",
            "config": {
                "use_images": True
            }
        },
        {
            "file_path": "https://img.zcool.cn/community/01889b5eff4d7fa80120662198e1bf.jpg?x-oss-process=image/auto-orient,1/resize,m_lfit,w_1280,limit_1/sharpen,100",
            "file_type": "image",
            "config": {
                "use_llm": False
            }
        },
        {
            "file_path": "https://www.learningcontainer.com/wp-content/uploads/2020/02/Kalimba.mp3",
            "file_type": "audio",
            "config": {
                "mode": "small"
            }
        }
    ]
    parser = FileToTextParser()
    parsed_content_list = parser.parse_multiple(file_configs)
    print(f"Parsed Content List:\n{parsed_content_list}")
