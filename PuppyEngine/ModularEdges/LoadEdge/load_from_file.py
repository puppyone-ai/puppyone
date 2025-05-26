# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import io
import os
import re
import json
import base64
import pymupdf
import easyocr
import whisper
import logging
import pypandoc
import requests
import traceback
import pymupdf4llm
import numpy as np
import pandas as pd
import multiprocessing
import time
from pydub import AudioSegment
from typing import List, Dict, Any, Tuple, Union
from Utils.puppy_exception import PuppyException, global_exception_handler
from Utils.logger import log_info, log_error, log_warning
import openpyxl


logger = logging.getLogger(__name__)


class FileToTextParser:
    """
    A class to parse various file types into text or structured data.
    Uses process isolation to handle non-thread-safe libraries.

    Attributes:
        root_path (str): The root directory path where files are located.
        file_path (str): The full path of the file to be parsed.
    """

    def __init__(
        self,
    ):
        """
        Initializes the FileToTextParser without shared resources
        """

        # Lazy loading flags - each process will load its own models
        self._whisper_model = None
        self._ocr_reader = None

        # Check/download pandoc once during initialization
        try:
            pandoc_path = pypandoc.get_pandoc_path()
            if not (pandoc_path and os.path.exists(pandoc_path)):
                pypandoc.download_pandoc()
        except Exception:
            pypandoc.download_pandoc()

    def _get_whisper_model(
        self,
        mode: str
    ) -> whisper.load_model:
        """
        Lazy loading whisper model
        """

        if self._whisper_model is None:
            self._whisper_model = whisper.load_model(
                "small" if mode == "accurate" else "base"
            )
        return self._whisper_model

    def _get_ocr_reader(
        self,
        language_list: list = None
    ) -> easyocr.Reader:
        """
        Lazy loading OCR reader
        """

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
        Parse multiple files using separate processes for thread-unsafe libraries
        while maintaining the original file sequence

        Args:
            file_configs: List of file configurations

        Returns:
            List of parsed file contents with user-friendly error messages for failures
        """

        # Initialize results array and error tracking
        results = [None] * len(file_configs)
        errors = []

        try:
            # Separate files into simple and complex types while preserving indices
            simple_files = []
            complex_files = []

            for i, config in enumerate(file_configs):
                file_path = config.get('file_path')
                file_type = config.get('file_type', '').lower() or self._determine_file_type(file_path)

                if file_type in ('json', 'txt', 'markdown', 'csv', 'xlsx'):
                    simple_files.append((i, config))
                else:
                    complex_files.append((i, config))

            # Process simple files directly
            if simple_files:
                self._process_simple_files(simple_files, results, errors)

            # Process complex files with multiprocessing
            if complex_files:
                self._process_complex_files(complex_files, results, errors)

            # Log error summary if needed
            if errors:
                logger.error(f"Encountered {len(errors)} errors while parsing files")

            return results
        except KeyboardInterrupt:
            logger.warning("Keyboard interrupt detected - stopping processes")
            return results
        except Exception as e:
            logger.error(f"Error in parse_multiple: {str(e)}\n{traceback.format_exc()}")
            raise

    def _process_simple_files(
        self,
        configs_with_indices: List[Tuple[int, Dict[str, Any]]],
        results: List[Any],
        errors: List[Tuple]
    ) -> None:
        """
        Process simple file types (json, txt, etc.) directly without multiprocessing

        Args:
            configs_with_indices: List of (index, config) tuples
            results: List to store results (modified in-place)
            errors: List to store errors (modified in-place)
        """

        for idx, config in configs_with_indices:
            try:
                file_path = config.get('file_path')
                parse_config = config.get('config', {})
                results[idx] = self.parse(file_path, file_type=config.get('file_type', ''), **parse_config)
            except Exception as e:
                # Log full error for developers
                error_details = traceback.format_exc()
                logger.error(f"Error processing {file_path}: {str(e)}\n{error_details}")

                # Store user-friendly error message
                results[idx] = f"Failed to parse file: {os.path.basename(file_path)}"
                errors.append((idx, e, error_details))

    def _process_complex_files(
        self,
        configs_with_indices: List[Tuple[int, Dict[str, Any]]],
        results: List[Any],
        errors: List[Tuple]
    ) -> None:
        """
        Process complex file types (images, audio, etc.) using multiprocessing
        if multiple cores are available, otherwise process sequentially

        Args:
            configs_with_indices: List of (index, config) tuples
            results: List to store results (modified in-place)
            errors: List to store errors (modified in-place)
        """
        
        # Only use multiprocessing if we have more than one CPU core
        cpu_count = multiprocessing.cpu_count()
        current_process = multiprocessing.current_process()
        logger.info(f"CPU Count: {cpu_count}, Current process: {current_process} with daemon: {current_process.daemon}")
        if cpu_count > 1 and not current_process.daemon:
            num_processes = max(1, min(cpu_count - 1, 4))
            
            # Use 'spawn' context for better Windows compatibility
            ctx = multiprocessing.get_context('spawn')
            with ctx.Pool(processes=num_processes) as pool:
                # Prepare arguments for each file
                args_list = [
                    (config.get('file_path'), 
                     config.get('file_type', ''), 
                     config.get('config', {})) 
                    for _, config in configs_with_indices
                ]

                # Use map_async with timeout to handle keyboard interrupts
                process_results = pool.map_async(self._process_file_wrapper, args_list).get(timeout=3600)

                # Collect results
                for (idx, _), result in zip(configs_with_indices, process_results):
                    results[idx] = result
                    if isinstance(result, str) and result.startswith("Failed to parse file:"):
                        errors.append((idx, "See log for details", ""))
        else:
            # Process files sequentially on single-core systems
            logger.info("Running in single-core mode - processing files sequentially")
            for idx, config in configs_with_indices:
                try:
                    file_path = config.get('file_path')
                    file_type = config.get('file_type', '')
                    parse_config = config.get('config', {})
                    results[idx] = self.parse(file_path, file_type, **parse_config)
                except Exception as e:
                    error_details = traceback.format_exc()
                    logger.error(f"Error processing {file_path}: {str(e)}\n{error_details}")
                    results[idx] = f"Failed to parse file: {os.path.basename(file_path)}"
                    errors.append((idx, e, error_details))

    def _process_file_wrapper(
        self,
        args: Tuple[str, str, Dict[str, Any]]
    ):
        """
        Helper function for multiprocessing - processes a single file in its own process

        Args:
            args: Tuple of (file_path, file_type, config)

        Returns:
            Parsed file content or error dict with user-friendly message
        """

        file_path, file_type, config = args
        try:
            # Create a new parser instance to ensure process isolation
            parser = FileToTextParser()
            return parser.parse(file_path, file_type, **config)
        except Exception as e:
            # Log the full error for developers
            error_details = traceback.format_exc()
            logger.error(f"Error processing {file_path}: {str(e)}\n{error_details}")

            # Return a user-friendly error message
            return f"Failed to parse file: {os.path.basename(file_path)}"

    # @global_exception_handler(1317, "Error Determining File Type")
    # def _determine_file_type(
    #     self,
    #     file_path: str
    # ) -> str:
    #     """
    #     Determine file type from file extension.

    #     Args:
    #         file_path: Path or URL to the file

    #     Returns:
    #         File type based on extension, defaults to 'application' for unknown extensions
    #     """

    #     _, ext = os.path.splitext(file_path)
    #     ext = ext.lower().lstrip('.')

    #     extension_map = {
    #         'json': 'json',
    #         'txt': 'txt',
    #         'md': 'markdown',
    #         'pdf': 'pdf',
    #         'doc': 'doc',
    #         'docx': 'doc',
    #         'csv': 'csv',
    #         'xlsx': 'xlsx',
    #         'xls': 'xlsx',
    #         'xlsm': 'xlsx',
    #         'xlsb': 'xlsx', 
    #         'ods': 'xlsx',
    #         'jpg': 'image',
    #         'jpeg': 'image',
    #         'png': 'image',
    #         'gif': 'image',
    #         'mp3': 'audio',
    #         'wav': 'audio',
    #         'mp4': 'video',
    #         'avi': 'video',
    #         'mov': 'video'
    #     }

    #     # Use the mapped file type or default to 'application' for unknown types
    #     file_type = extension_map.get(ext, 'application')
    #     return file_type

    def _normalize_file_type(self, file_type: str) -> str:
        """
        Normalize the file type to a standard format that matches internal parsing methods.
        
        Args:
            file_type: The input file type or extension
            
        Returns:
            Normalized file type as used by internal parse methods or None if not supported
        """
        # 标准类型列表（与extension_map的值保持一致）
        standard_types = {
            'json', 'txt', 'markdown', 'pdf', 'doc', 
            'csv', 'xlsx', 'image', 'audio', 'video', 'application'
        }
        
        # 如果file_type已经是标准类型，直接返回
        if file_type in standard_types:
            return file_type
            
        # 扩展名映射（与_determine_file_type中的extension_map保持一致）
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
            'xlsm': 'xlsx',
            'xlsb': 'xlsx', 
            'ods': 'xlsx',
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
        
        # 返回映射的类型，如果没有映射则返回None
        return extension_map.get(file_type.lower())

    def parse(
        self,
        file_path: str,
        file_type: str = "",
        **kwargs
    ) -> str:
        """
        Parses the given file based on its type.
        
        Args:
            file_path (str): The path to the file to be parsed.
            file_type (str, optional): The type of the file to be parsed or its extension. 
                                      If empty, will be determined from file extension.
            **kwargs: Additional keyword arguments for specific parsing methods.

        Returns:
            str: The parsed content of the file.

        Raises:
            PuppyException: If the file type is unsupported.
        """
        # 如果未提供file_type或为空字符串，根据文件路径自动判断
        if not file_type:
            file_type = self._determine_file_type(file_path)
        else:
            # 确保file_type是标准化的内部类型
            normalized_type = self._normalize_file_type(file_type)
            if normalized_type is None:
                raise PuppyException(1301, f"Unsupported File Type: {file_type}")
            file_type = normalized_type

        method_name = f"_parse_{file_type}"
        parse_method = getattr(self, method_name, None)
        if not parse_method:
            raise PuppyException(1301, f"Unsupported File Type: {file_type}")
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
            PuppyException: If any additional arguments are provided.
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
        auto_formatting: bool = True,
        **kwargs
    ) -> str:
        """
        Parse DOC/DOCX files into text.

        Args:
            file_path: Path to the DOC/DOCX file
            auto_formatting: Whether to preserve formatting

        Returns:
            Extracted text content
        """

        if self._is_file_url(file_path):
            response = requests.get(file_path)
            response.raise_for_status()
            output = pypandoc.convert_text(
                response.content,
                "markdown",
                format="docx",
                encoding="utf-8"
            )
        else:
            output = pypandoc.convert_file(
                file_path, 
                "markdown", 
                encoding="utf-8"
            )

        # Clean up the output
        output = output.replace('\\"', '"').replace("\\'", "'")

        if not auto_formatting:
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

        pdf = file_path
        if self._is_file_url(file_path):
            file_object = self._remote_file_to_byte_io(file_path)
            pdf = pymupdf.open(stream=file_object, filetype='pdf')

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
    ) -> Union[str, Dict[str, List], List[Dict[str, Any]]]:
        """
        Parses a CSV file and returns its content in specified format.
        Args:
            file_path (str): The path to the CSV file to be parsed.
            **kwargs: Additional arguments for specific parsing options.
            - column_range (list): The range of columns to parse. In form of [start, end].
            - row_range (list): The range of rows to parse. In form of [start, end].
            - mode (str): Output format mode. One of:
                - 'string': CSV format string (default)
                - 'column': Dict with column names as keys and column values as lists
                - 'row': List of dicts, each dict representing a row with column names as keys
        Returns:
            Union[str, Dict[str, List], List[Dict[str, Any]]]: Parsed CSV content in specified format
        """
        column_range = kwargs.get("column_range", None)
        row_range = kwargs.get("row_range", None)
        mode = kwargs.get("mode", "row")
        if (column_range and not isinstance(column_range, list)) or (row_range and not isinstance(row_range, list)):
            raise ValueError("Column range and row range should be lists of integers!")
        if mode not in {"string", "column", "row"}:
            raise ValueError("Mode must be one of: 'string', 'column', 'row'")
        csv_file = file_path
        if self._is_file_url(file_path):
            csv_file = self._remote_file_to_byte_io(file_path)
        df = pd.read_csv(csv_file)
        if column_range:
            df = df.iloc[:, column_range[0]:column_range[1]]
        if row_range:
            df = df.iloc[row_range[0]:row_range[1]]
        if mode == "string":
            return df.to_csv(index=False)
        elif mode == "column":
            return df.to_dict(orient='list')
        else:  # mode == "row"
            return df.to_dict(orient='records')

    @global_exception_handler(1308, "Error Parsing XLSX File")
    def _parse_xlsx(
        self,
        file_path: str,
        **kwargs
    ) -> Union[str, Dict[str, Any], List[Dict[str, Any]]]:
        """
        Parses an Excel file (XLSX, XLS, XLSM, XLSB, ODS) and returns its content in specified format.
        Args:
            file_path (str): The path to the Excel file to be parsed.
            **kwargs: Additional arguments for specific parsing options.
                - column_range (list): The range of columns to parse. In form of [start, end].
                - row_range (list): The range of rows to parse. In form of [start, end].
                - mode (str): Output format mode. One of:
                    - 'auto': Automatically detect and select the best parsing mode (default)
                    - 'string': CSV format string
                    - 'column': Dict with column names as keys and column values as lists
                    - 'row': List of dicts, each dict representing a row with column names as keys
                    - 'line': JSON string representation of the data
                - sheet_name (str, int, list, None): The name or index of the sheet to parse.
                    - str/int: Parse a single sheet
                    - list: Parse multiple specific sheets
                    - None: Parse all available sheets (default)
                - filter_empty (bool): Whether to filter out empty values in row mode. Default is True.
        Returns:
            Union[str, Dict[str, Any], List[Dict[str, Any]]]: 
                When sheet_name is None or a list: Dict with sheet names as keys and parsed content as values
                Otherwise: Parsed Excel content in specified format
                
        TODO:
            - Enhance intelligent mode detection algorithm with more table features
            - Add machine learning model for table structure recognition
            - Support more data types and special format detection
            - Implement user feedback mechanism to optimize mode selection
        """
        start_time = time.time()
        file_name = os.path.basename(file_path) if isinstance(file_path, str) else "stream"
        log_info(f"Starting to parse Excel file: {file_name}")
        
        column_range = kwargs.get("column_range", None)
        row_range = kwargs.get("row_range", None)
        mode = kwargs.get("mode", "auto")  # 默认使用自动检测模式
        sheet_name = kwargs.get("sheet_name", None)  # 默认解析所有表格
        filter_empty = kwargs.get("filter_empty", True)

        if (column_range and not isinstance(column_range, list)) or (row_range and not isinstance(row_range, list)):
            raise ValueError("Column range and row range should be lists of integers!")
        if mode not in {"auto", "string", "column", "row", "line"}:
            raise ValueError("Mode must be one of: 'auto', 'string', 'column', 'row', 'line'")

        xlsx_file = file_path
        if self._is_file_url(file_path):
            xlsx_file = self._remote_file_to_byte_io(file_path)
        
        # 处理多表情况
        parse_all_sheets = sheet_name is None
        
        try:
            if parse_all_sheets:
                # 获取所有表名并创建结果字典
                excel_file = pd.ExcelFile(xlsx_file)
                all_sheets = excel_file.sheet_names
                result = {}
                
                log_info(f"Excel file {file_name} contains {len(all_sheets)} sheets")
                successful_sheets = 0
                failed_sheets = 0
                
                # 为每个表调用自身，递归处理
                for i, sheet in enumerate(all_sheets):
                    sheet_start_time = time.time()
                    log_info(f"Processing sheet {i+1}/{len(all_sheets)}: {sheet}")
                    
                    try:
                        # 递归调用自身处理单个表
                        result[sheet] = self._parse_single_sheet(xlsx_file, sheet, column_range, row_range, mode, filter_empty)
                        sheet_end_time = time.time()
                        log_info(f"Successfully processed sheet {sheet}, took {sheet_end_time - sheet_start_time:.2f} seconds")
                        successful_sheets += 1
                    except Exception as e:
                        sheet_end_time = time.time()
                        log_error(f"Failed to process sheet {sheet}: {str(e)}, took {sheet_end_time - sheet_start_time:.2f} seconds")
                        # 记录详细错误信息但继续处理其他表
                        result[sheet] = f"Parsing failed: {str(e)}"
                        failed_sheets += 1
                
                end_time = time.time()
                log_info(f"Excel file {file_name} parsing completed, {len(all_sheets)} sheets total, {successful_sheets} successful, {failed_sheets} failed, total time: {end_time - start_time:.2f} seconds")
                return result
            
            # 处理单表或特定多表的情况
            if isinstance(sheet_name, list):
                # 处理特定多表
                log_info(f"Starting to process {len(sheet_name)} specified sheets in Excel file {file_name}")
                result = {}
                successful_sheets = 0
                failed_sheets = 0
                
                for i, sheet in enumerate(sheet_name):
                    sheet_start_time = time.time()
                    log_info(f"Processing sheet {i+1}/{len(sheet_name)}: {sheet}")
                    
                    try:
                        result[sheet] = self._parse_single_sheet(xlsx_file, sheet, column_range, row_range, mode, filter_empty)
                        sheet_end_time = time.time()
                        log_info(f"Successfully processed sheet {sheet}, took {sheet_end_time - sheet_start_time:.2f} seconds")
                        successful_sheets += 1
                    except Exception as e:
                        sheet_end_time = time.time()
                        log_error(f"Failed to process sheet {sheet}: {str(e)}, took {sheet_end_time - sheet_start_time:.2f} seconds")
                        # 记录详细错误信息但继续处理其他表
                        result[sheet] = f"Parsing failed: {str(e)}"
                        failed_sheets += 1
                
                end_time = time.time()
                log_info(f"Excel file {file_name} specified sheets parsing completed, {len(sheet_name)} sheets total, {successful_sheets} successful, {failed_sheets} failed, total time: {end_time - start_time:.2f} seconds")
                return result
            
            # 单表处理
            sheet_start_time = time.time()
            sheet_name_str = sheet_name if isinstance(sheet_name, str) else f"Sheet {sheet_name}"
            log_info(f"Processing sheet: {sheet_name_str}")
            
            result = self._parse_single_sheet(xlsx_file, sheet_name, column_range, row_range, mode, filter_empty)
            
            end_time = time.time()
            log_info(f"Sheet {sheet_name_str} parsing completed, took {end_time - sheet_start_time:.2f} seconds")
            return result
            
        except Exception as e:
            end_time = time.time()
            log_error(f"Error occurred while parsing Excel file {file_name}: {str(e)}, total time: {end_time - start_time:.2f} seconds")
            # 使用PuppyException格式化并抛出错误
            raise PuppyException(1308, "Error Parsing XLSX File", str(e))

    def _detect_best_mode(self, df):
        """
        Intelligently detect the best parsing mode based on table structure.
        
        Args:
            df (pd.DataFrame): The DataFrame to analyze
            
        Returns:
            str: Recommended parsing mode ('row', 'column', 'string', or 'line')
            
        TODO:
            - Add header feature analysis
            - Implement data type distribution detection
            - Add data density and sparsity analysis
            - Implement special format table recognition (pivot tables, cross tables, etc.)
            - Add time series and hierarchical structure detection
            - Consider using machine learning models instead of rule-based system
            - Add context relationship and symmetry detection
        """
        # 空表或极小表格
        if df.empty or len(df.columns) <= 1:
            return "row"  # 默认使用row模式
            
        # 检查行列比例
        row_count = len(df)
        col_count = len(df.columns)
        
        # 检查第一列的唯一值比例
        if row_count > 0:
            first_col = df.columns[0]
            unique_values = df[first_col].nunique()
            unique_ratio = unique_values / row_count if row_count > 0 else 0
            
            # 如果第一列大部分值唯一，适合row模式
            if unique_ratio > 0.8:
                return "row"
                
            # 如果第一列有大量重复值，可能适合column模式
            elif unique_ratio < 0.2 and col_count < row_count:
                return "column"
        
        # 检查表格形状
        if row_count > col_count * 3:
            # 长表格(行远多于列)，通常适合row模式
            return "row"
        elif col_count > row_count * 2:
            # 宽表格(列远多于行)，可能适合column模式
            return "column"
        
        # 默认使用row模式
        return "row"
        
    def _parse_single_sheet(
        self, 
        xlsx_file, 
        sheet_name, 
        column_range=None, 
        row_range=None, 
        mode="auto", 
        filter_empty=True
    ):
        """
        Helper method to parse a single sheet from an Excel file.
        
        Args:
            xlsx_file: Excel file path or BytesIO object
            sheet_name: Sheet name or index
            column_range: Column range to parse
            row_range: Row range to parse
            mode: Parsing mode, one of 'auto', 'string', 'column', 'row', or 'line'
            filter_empty: Whether to filter out empty values
            
        Returns:
            Parsed sheet content in the specified format
        """
        try:
            sheet_name_str = sheet_name if isinstance(sheet_name, str) else f"Sheet {sheet_name}"
            log_info(f"Reading data from sheet {sheet_name_str}")
            df = pd.read_excel(xlsx_file, sheet_name=sheet_name)
            
            log_info(f"Sheet {sheet_name_str} contains {len(df)} rows, {len(df.columns)} columns")
            
            # 处理合并单元格
            log_info(f"Processing merged cells in sheet {sheet_name_str}")
            
            # 应用行列过滤
            if column_range:
                log_info(f"Applying column range filter: {column_range}")
                df = df.iloc[:, column_range[0]:column_range[1]]
            if row_range:
                log_info(f"Applying row range filter: {row_range}")
                df = df.iloc[row_range[0]:row_range[1]]

            # 处理空值
            log_info("Processing null values and standardizing data types")
            df = df.replace({pd.NA: None, pd.NaT: None})  # 将pandas的空值转换为None
            
            # 检查是否为空表格
            if df.empty or len(df.columns) == 0:
                log_warning(f"Sheet {sheet_name_str} is empty or has no valid columns")
                if mode == "string":
                    return ""
                elif mode == "line":
                    return "[]"
                else:  # column or row mode
                    return {}
                    
            # 添加自动模式检测
            if mode == "auto":
                detected_mode = self._detect_best_mode(df)
                log_info(f"Auto-detected best parsing mode: {detected_mode}")
                mode = detected_mode

            log_info(f"Using mode '{mode}' to parse sheet {sheet_name_str}")
            
            # 执行相应模式的解析
            if mode == "string":
                return df.to_csv(index=False)
            elif mode == "column":
                # 获取列名和索引
                columns = df.columns.tolist()
                
                # 处理没有列的情况
                if not columns:
                    return {}
                    
                first_col = columns[0]
                
                # 创建结果字典
                result = {}
                
                # 如果只有一列，返回空字典
                if len(columns) <= 1:
                    return result
                
                # 处理每一列（除了第一列）
                for col in columns[1:]:
                    # 创建内层字典，使用第一列作为键
                    inner_dict = {}
                    
                    # 遍历每一行
                    for idx in df.index:
                        key = df.loc[idx, first_col]
                        value = df.loc[idx, col]
                        
                        # 忽略空值
                        if pd.notna(key) and pd.notna(value) and value != "" and value is not None:
                            # 处理日期时间类型
                            try:
                                if isinstance(value, pd.Timestamp) or pd.api.types.is_datetime64_any_dtype(value):
                                    inner_dict[key] = str(value)
                                else:
                                    inner_dict[key] = value
                            except Exception as e:
                                # 如果类型检测失败，保持原值
                                inner_dict[key] = value
                    
                    # 如果内层字典为空，根据filter_empty决定是否添加
                    if inner_dict or not filter_empty:
                        result[col] = inner_dict
                
                return result
            elif mode == "line":
                # 将DataFrame转换为JSON格式,处理日期时间等特殊类型
                def json_serialize(obj):
                    if isinstance(obj, pd.Timestamp) or hasattr(obj, 'isoformat'):
                        return str(obj)
                    return obj
                
                # 将DataFrame转换为记录列表
                records = df.replace({pd.NA: None, pd.NaT: None}).to_dict(orient='records')
                
                # 返回JSON字符串
                return json.dumps(records, default=json_serialize, ensure_ascii=False)
            else:  # mode == "row"
                # 获取列名
                columns = df.columns.tolist()
                
                # 处理没有列的情况
                if not columns:
                    return {}
                    
                first_col = columns[0]
                
                # 如果只有一列，返回以第一列值为键，空字典为值的结构
                if len(columns) <= 1:
                    result = {}
                    for _, row in df.iterrows():
                        key = row[first_col]
                        if pd.notna(key):
                            result[key] = {}
                    return result
                
                other_cols = columns[1:]
                
                # 创建结果字典
                result = {}
                
                # 遍历DataFrame的每一行
                total_rows = len(df)
                log_info(f"Starting to process {total_rows} rows of data")
                
                for i, (_, row) in enumerate(df.iterrows()):
                    key = row[first_col]
                    
                    # 创建内层字典，忽略空值
                    inner_dict = {}
                    for col in other_cols:
                        # 更全面地检测空值
                        if pd.notna(row[col]) and row[col] != "" and row[col] is not None:
                            # 处理日期时间类型
                            try:
                                if isinstance(row[col], pd.Timestamp) or pd.api.types.is_datetime64_any_dtype(row[col]):
                                    inner_dict[col] = str(row[col])
                                else:
                                    inner_dict[col] = row[col]
                            except Exception as e:
                                # 如果类型检测失败，保持原值
                                inner_dict[col] = row[col]
                    
                    # 如果内层字典为空且第一列也为空，则跳过整行
                    if not inner_dict and pd.isna(key):
                        continue
                        
                    # 处理第一列为空的情况
                    if pd.isna(key):
                        if "null_values" not in result:
                            result["null_values"] = []
                        result["null_values"].append(inner_dict)
                        continue
                        
                    # 处理第一列有重复值的情况
                    if key in result:
                        # 合并内层字典
                        result[key].update(inner_dict)
                    else:
                        # 只有当内层字典非空时才添加
                        if inner_dict or not filter_empty:
                            result[key] = inner_dict
                
                log_info(f"Successfully processed {len(result)} effective data entries")
                return result
                
        except Exception as e:
            sheet_name_str = sheet_name if isinstance(sheet_name, str) else f"Sheet {sheet_name}"
            error_msg = f"Error while parsing sheet {sheet_name_str}: {str(e)}"
            log_error(error_msg)
            log_error(traceback.format_exc())
            raise PuppyException(1308, f"Error Parsing Sheet '{sheet_name_str}'", str(e))

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

    # @global_exception_handler(1318, "Error Parsing Unknown File Type")
    # def _parse_application(
    #     self,
    #     file_path: str,
    #     **kwargs
    # ) -> Dict[str, Any]:
    #     """
    #     Generic file handler for unknown or binary file types.
        
    #     Args:
    #         file_path (str): Path to the file to be parsed.
    #         **kwargs: Additional arguments for specific parsing options.
    #             - max_text_size (int): Maximum bytes to read when attempting text parsing, default 4096
    #             - include_binary (bool): Whether to include binary content digest, default False
                
    #     Returns:
    #         Dict[str, Any]: Dictionary containing file information, which may include:
    #             - file_name: Name of the file
    #             - file_size: Size of the file in bytes
    #             - is_text: Whether the file appears to be text
    #             - text_preview: Preview of text content if is_text=True
    #             - binary_preview: Hex digest preview if is_text=False and include_binary=True
    #             - mime_type: MIME type if python-magic library is available
    #             - detected_type: Basic file type detection if python-magic is unavailable
            
    #     Notes:
    #         This method is designed with extensibility in mind:
    #         - The **kwargs parameter allows adding new options without changing the interface
    #         - Future extensions could include encoding detection, metadata extraction, etc.
            
    #         File type detection uses two approaches:
    #         - Primary: python-magic library for accurate content-based MIME type detection
    #         - Fallback: Basic signature detection for common file types when python-magic is unavailable
    #     """
    #     max_text_size = kwargs.get("max_text_size", 4096)  # Default to reading first 4KB
    #     include_binary = kwargs.get("include_binary", False)
        
    #     result = {
    #         "file_name": os.path.basename(file_path),
    #         "is_text": False
    #     }
    #     # Get file size and read content
    #     if self._is_file_url(file_path):
    #         response = requests.head(file_path)
    #         file_size = int(response.headers.get('Content-Length', 0))
    #         content = self._remote_file_to_byte_io(file_path).read(max_text_size)
    #     else:
    #         file_size = os.path.getsize(file_path)
    #         with open(file_path, 'rb') as f:
    #             content = f.read(max_text_size)  
    #     result["file_size"] = file_size
    #     # Try to decode as text
    #     try:
    #         text = content.decode('utf-8')
    #         result["is_text"] = True
    #         result["text_preview"] = text[:1000] + ("..." if len(text) > 1000 else "")
    #     except UnicodeDecodeError:
    #         # Binary file
    #         if include_binary:
    #             # Provide hex digest preview
    #             hex_preview = content[:100].hex()
    #             result["binary_preview"] = f"{hex_preview[:50]}...{hex_preview[-50:]}" if len(hex_preview) > 100 else hex_preview  
    #     # File type detection
    #     try:
    #         import magic  # Use python-magic library if available
    #         result["mime_type"] = magic.from_buffer(content, mime=True)
    #     except ImportError:
    #         # If magic library is unavailable, attempt basic feature detection
    #         if content.startswith(b'%PDF'):
    #             result["detected_type"] = "pdf"
    #         elif content.startswith(b'\x89PNG'):
    #             result["detected_type"] = "png"
    #         # More signature detections could be added here
    #     return result


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
        },
        {
            "file_path": os.path.join(file_root_path, "ld.xlsm"),
            "file_type": "xlsm",
            "config": {
                "mode": "row", 
                "sheet_name": "费用"
            }
        },
        {
            "file_path": os.path.join(file_root_path, "Resume cover letter for temporary position.docx"),
            "file_type": "doc",
            "config": {
                "auto_formatting": True
            }
        }, 
        {
            "file_path": os.path.join(file_root_path, "testcsv.csv"),
            "file_type": "csv",
        }
    ]
    parser = FileToTextParser()
    parsed_content_list = parser.parse_multiple(file_configs)
    print(f"Parsed Content List:\n{parsed_content_list}")
    print(f"Parsed Config List:\n{file_configs}")

