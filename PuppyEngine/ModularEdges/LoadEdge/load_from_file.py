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
from pydub import AudioSegment
from typing import List, Dict, Any, Tuple, Union
from Utils.puppy_exception import PuppyException, global_exception_handler


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

    # def _group_files_by_type(
    #     self, 
    #     file_configs: List[Dict[str, Any]]
    # ) -> Dict[str, List[Tuple[int, Dict[str, Any]]]]:
    #     """
    #     Group file configurations by file type

    #     Args:
    #         file_configs: List of file configurations

    #     Returns:
    #         Dictionary mapping file types to lists of (index, config) tuples
    #     """

    #     file_type_groups = {}
    #     for i, config in enumerate(file_configs):
    #         file_path = config.get('file_path')
    #         file_type = config.get('file_type', '').lower() or self._determine_file_type(file_path)

    #         if file_type not in file_type_groups:
    #             file_type_groups[file_type] = []

    #         file_type_groups[file_type].append((i, config))

    #     return file_type_groups

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
                - 'string': CSV format string
                - 'column': Pivot mode, column names as main keys, values from index_row as sub-keys
                - 'row': Pivot mode, values from index_col as main keys, column names as sub-keys
            - use_header (bool): Whether to use the first row as column headers, default is True
            - skip_empty (bool): Whether to skip empty values in pivot result, default is True
            - index_col (str/int): Column to use as main key in row mode, default is first column (0)
            - index_row (int): Row to use for sub-keys in column mode, default is first data row (0)
        Returns:
            Union[str, Dict[str, List], List[Dict[str, Any]]]: Parsed CSV content in specified format
        """
        column_range = kwargs.get("column_range", None)
        row_range = kwargs.get("row_range", None)
        mode = kwargs.get("mode", "row")
        use_header = kwargs.get("use_header", True)
        skip_empty = kwargs.get("skip_empty", True)
        index_col = kwargs.get("index_col", 0)  # Default to using first column as main key
        index_row = kwargs.get("index_row", 0)  # Default to using first row for column mode sub-keys

        if (column_range and not isinstance(column_range, list)) or (row_range and not isinstance(row_range, list)):
            raise ValueError("Column range and row range should be lists of integers!")

        if mode not in {"string", "column", "row"}:
            raise ValueError("Mode must be one of: 'string', 'column', 'row'")

        csv_file = file_path
        if self._is_file_url(file_path):
            csv_file = self._remote_file_to_byte_io(file_path)

        # Determine whether to use first row as column headers
        header_param = 0 if use_header else None
        df = pd.read_csv(csv_file, header=header_param)
        
        # Ensure all column names are strings
        df.columns = df.columns.astype(str)
        
        if column_range:
            df = df.iloc[:, column_range[0]:column_range[1]]
        if row_range:
            df = df.iloc[row_range[0]:row_range[1]]

        if mode == "string":
            # Return CSV format string
            return df.to_csv(index=False)
        
        elif mode == "column":
            # Column pivot mode: column names as main keys, values from index_row as sub-keys
            if df.empty:
                return "{}"
                
            result = {}
            
            # If DataFrame has fewer rows than index_row, return empty result
            if len(df) <= index_row:
                return "{}"
            
            # Get column names for main keys
            columns = df.columns.tolist()
            
            # If index_col is a number, use position; if string, use column name
            key_col = df.columns[index_col] if isinstance(index_col, int) else index_col
            
            # Get values from the specified row to use as sub-keys
            row_values = df.iloc[index_row]
            key_values = df[key_col].tolist()
            
            # Iterate through each column (except the key column)
            for col in columns:
                if col == key_col:
                    continue
                    
                # Use column name as outer key
                outer_key = str(col)
                result[outer_key] = {}
                
                # Iterate through each row
                for i, idx in enumerate(df.index):
                    # Skip the row used for keys in column mode if needed
                    if skip_empty and i == index_row:
                        continue
                        
                    # Get the key value and data value
                    sub_key = df.iloc[i][key_col]
                    value = df.iloc[i][col]
                    
                    # Skip empty values
                    if skip_empty and (pd.isna(sub_key) or sub_key == '' or pd.isna(value) or value == ''):
                        continue
                    
                    # Ensure sub-key is string
                    sub_key = str(sub_key)
                    
                    # Preserve numeric types, convert others to string
                    if isinstance(value, (int, float)):
                        if not pd.isna(value):  # Ensure not NaN
                            result[outer_key][sub_key] = value
                    else:
                        result[outer_key][sub_key] = str(value)
            
            # Return JSON string
            return json.dumps(result, ensure_ascii=False)
            
        else:  # mode == "row"
            # Row pivot mode: specified column as main keys, column names as sub-keys
            if df.empty:
                return "{}"
            
            # If index_col is a number, use position; if string, use column name
            key_col = df.columns[index_col] if isinstance(index_col, int) else index_col
            
            result = {}
            # Get all row indices
            indices = df.index.tolist()
            # Get all columns except the key column
            if isinstance(index_col, int):
                other_cols = [col for i, col in enumerate(df.columns) if i != index_col]
            else:
                other_cols = [col for col in df.columns if col != key_col]
            
            # Iterate through each row
            for idx in indices:
                row = df.iloc[idx]
                
                # Use key column value as outer key
                outer_key = row[key_col]
                # Skip empty main keys
                if pd.isna(outer_key) or outer_key == '':
                    continue
                
                # Ensure main key is string type
                outer_key = str(outer_key)
                if outer_key not in result:
                    result[outer_key] = {}
                
                # Add other column data as inner key-value pairs
                for col in other_cols:
                    value = row[col]
                    # Skip empty values
                    if skip_empty and (pd.isna(value) or value == ''):
                        continue
                    # Preserve numeric types, convert others to string
                    if isinstance(value, (int, float)):
                        if not pd.isna(value):  # Ensure not NaN
                            result[outer_key][col] = value
                    else:
                        result[outer_key][col] = str(value)
            
            # Return JSON string
            return json.dumps(result, ensure_ascii=False)

    @global_exception_handler(1308, "Error Parsing XLSX File")
    def _parse_xlsx(
        self,
        file_path: str,
        **kwargs
    ) -> str:
        """
        Parses an Excel file (XLSX, XLS, XLSM, XLSB, ODS) and returns its content as CSV format string.

        Args:
            file_path (str): The path to the Excel file to be parsed.
            **kwargs: Additional arguments for specific parsing options.
            - column_range (list): The range of columns to parse. In form of [start, end].
            - row_range (list): The range of rows to parse. In form of [start, end].
            - sheet_name (str or int): Sheet name or index to parse, default is 0
            - use_header (bool): Whether to use the first row as column headers, default is True
            - na_filter (bool): Whether to detect NA/NaN values, default is True

        Returns:
            str: Parsed Excel content in CSV format string
        """

        column_range = kwargs.get("column_range", None)
        row_range = kwargs.get("row_range", None)
        sheet_name = kwargs.get("sheet_name", 0)
        use_header = kwargs.get("use_header", True)
        na_filter = kwargs.get("na_filter", True)  # Default to detect NA values

        if (column_range and not isinstance(column_range, list)) or (row_range and not isinstance(row_range, list)):
            raise ValueError("Column range and row range should be lists of integers!")

        xlsx_file = file_path
        if self._is_file_url(file_path):
            xlsx_file = self._remote_file_to_byte_io(file_path)

        # Determine whether to use first row as column headers
        header_param = 0 if use_header else None
        
        # Read Excel file
        df = pd.read_excel(
            xlsx_file, 
            sheet_name=sheet_name, 
            header=header_param,
            na_filter=na_filter
        )
        
        # Ensure all column names are strings
        df.columns = df.columns.astype(str)
        
        if column_range:
            df = df.iloc[:, column_range[0]:column_range[1]]
        if row_range:
            df = df.iloc[row_range[0]:row_range[1]]

        # Return CSV format string
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
            "file_path": os.path.join(file_root_path, "test.xlsx"),
            "file_type": "xlsx"
        },
        # 其他测试文件配置...
    ]
    parser = FileToTextParser()
    parsed_content_list = parser.parse_multiple(file_configs)
    print(f"Parsed Content List:\n{parsed_content_list}")
    print(f"Parsed Config List:\n{file_configs}")

    
