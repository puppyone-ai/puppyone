# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import os
import logging
from typing import Dict, Any
from Blocks.WebScrape import WebScraper
from Blocks.Database import DatabaseFactory
from Blocks.FileLoader import FileToTextParser
from Utils.PuppyEngineExceptions import PuppyEngineException, global_exception_handler


class DataLoader:
    """
    Class to create and load data content from blocks based on block type.

    Methods:
        process: Creates and processes the appropriate block based on block type.
    """

    def __init__(
        self,
        block_type: str,
        data: Dict[str, Any]
    ):
        self.block_type = block_type
        self.data = data

    @global_exception_handler(1005, "Unexpected Error in Loading Block")
    def load(
        self
    ) -> Any:
        loader_dict = {
            "text": self._load_text,
            "structured": self._load_structured_text,
            "weblink": self._load_weblink,
            "file": self._load_file,
            "database": self._load_database
        }
        loader = loader_dict.get(self.block_type)
        if not loader:
            raise ValueError(f"Unsupported Block Type: {self.block_type}")
        return loader()

    @global_exception_handler(1000, "Unexpected Error in Loading Text")
    def _load_text(
        self
    ) -> str:
        text = self.data.get("content", "")
        if not text:
            raise PuppyEngineException(1100, "Empty Text Content")
        return text

    @global_exception_handler(1001, "Unexpected Error in Loading Structure Text")
    def _load_structured_text(
        self
    ) -> Dict[str, Any]:
        structured = self.data.get("content", {})
        if not structured:
            raise PuppyEngineException(1101, "Empty Structured Text Content")
        return structured

    @global_exception_handler(1002, "Unexpected Error in Loading Weblink")
    def _load_weblink(
        self
    ) -> str:
        url = self.data.get("content", "")
        if not url:
            raise PuppyEngineException(1200, "Empty Weblink")

        extra_config = self.data.get("extra_config", {})

        mode = extra_config.get("mode", "scrape").lower()
        extra_config.pop("mode", None)
        mode_dict = {
            "map": "url_map",
            "scrape": "url_scrape",
            "scrapes": "scrape_multiple",
            "crawl": "url_crawl"
        }

        if mode not in mode_dict:
            raise PuppyEngineException(1201, "Invalid Mode", f"Invalid mode '{mode}' provided. Supported modes: {list(mode_dict.keys())}")

        scraper = WebScraper()

        logging.info(f"Fetching web content using mode '{mode}' for URL: {url}")
        web_content = getattr(scraper, mode_dict[mode])(url, **extra_config)
        return web_content

    @global_exception_handler(1003, "Unexpected Error in Loading File")
    def _load_file(
        self
    ) -> str:
        file_path = self.data.get("content", "")
        if not file_path:
            raise PuppyEngineException(1300, "Empty File Path")

        root_path, file_name = os.path.split(file_path)
        extra_configs = self.data.get("extra_configs", {})
        file_type = extra_configs.get("type", "txt")
        extra_configs.pop("type", None)

        file_parser = FileToTextParser(root_path=root_path)
        return file_parser.parse(
            file_name=file_name,
            file_type=file_type,
            **extra_configs
        )

    @global_exception_handler(1004, "Unexpected Error in Loading Database")
    def _load_database(
        self
    ) -> dict:
        db_configs = self.data.get("content", {})
        if not db_configs:
            raise PuppyEngineException(1400, "Empty Database Configuration")
        extra_configs = self.data.get("extra_configs", {})
        client_name = extra_configs.get("client_name", "")
        table_name = extra_configs.get("table_name", "")
        columns = extra_configs.get("columns", [])
        rows = extra_configs.get("rows", [])

        db_loader = DatabaseFactory(db_configs)
        metadata = db_loader.get_metadata(client_name)
        logging.info(f"Metadata for client '{client_name}': {metadata}")
        return db_loader.query(client_name, table_name, columns, rows)

