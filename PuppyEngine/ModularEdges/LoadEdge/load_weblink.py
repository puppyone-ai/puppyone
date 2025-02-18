# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import logging
from ModularEdges.LoadEdge.base_load import LoadStrategy
from ModularEdges.LoadEdge.load_from_weblink import WebScraper
from Utils.PuppyEngineExceptions import global_exception_handler, PuppyEngineException


class WeblinkLoadStrategy(LoadStrategy):
    @global_exception_handler(1002, "Unexpected Error in Loading Weblink")
    def load(
        self
    ) -> str:
        self.validate_content()
        
        mode = self.extra_configs.get("mode", "scrape").lower()
        mode_dict = {
            "map": "url_map",
            "scrape": "url_scrape",
            "scrapes": "scrape_multiple",
            "crawl": "url_crawl"
        }

        if mode not in mode_dict:
            raise PuppyEngineException(1201, "Invalid Mode", 
                                     f"Invalid mode `{mode}`. Supported: {list(mode_dict.keys())}")

        scraper = WebScraper()
        logging.info(f"Fetching web content using mode `{mode}` for URL: {self.content}")
        return getattr(scraper, mode_dict[mode])(self.content, **self.extra_configs)
