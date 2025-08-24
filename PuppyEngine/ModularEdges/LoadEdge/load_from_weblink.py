# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import os
import concurrent.futures
from typing import List, Optional
from firecrawl import FirecrawlApp
from Utils.puppy_exception import PuppyException, global_exception_handler


class WebScraper:
    def __init__(
        self,
        api_key: Optional[str] = None
    ):
        api_key = api_key or os.environ.get("FIRECRAWL_API_KEY")
        self.api_client = FirecrawlApp(api_key or os.environ.get("FIRECRAWL_API_KEY"))
        if not api_key:
            raise PuppyException(1202, "Invalid or Missing FireCrawl API Key", f"FIRECRAWL_API_KEY: {api_key}")

    @global_exception_handler(1203, "Error in getting URL Mapping")
    def url_map(
        self,
        url: str
    ) -> List[str]:
        """
        Maps the URL to all the other URLs that are linked to it
        
        Args:
            url (str): The URL to map
        """

        return self.api_client.map(url)

    @global_exception_handler(1204, "Error in Scraping URL")
    def url_scrape(
        self,
        url: str,
        formats: List[str] = ["markdown", "html"],
        is_only_main_content: bool = True,
        include_tags: List[str] = [],
        exclude_tags: List[str] = [],
        skip_tls_verification: bool = True,
        wait_for: int = 120,
        remove_base64_images: bool = True
    ) -> str:
        """
        Scrapes the content of the URL and returns the content in the specified formats
        
        Args:
            url (str): The URL to scrape
            formats (List[str], optional): The formats in which the content should be returned. Defaults to ["markdown", "html"].
            is_only_main_content (bool, optional): Whether only the main content should be scraped. Defaults to True.
            include_tags (List[str], optional): The tags to include in the scraped content. Defaults to [].
            exclude_tags (List[str], optional): The tags to exclude from the scraped content. Defaults to [].
            skip_tls_verification (bool, optional): Whether to skip TLS verification. Defaults to True.
            wait_for (int, optional): The time to wait for the page to load. Defaults to 120.
            remove_base64_images (bool, optional): Whether to remove base64 images. Defaults to True.
        
        Returns:
            str: The scraped content in the specified formats
        """

        scrape_result = self.api_client.scrape(
            url,
            formats=formats,
            only_main_content=is_only_main_content,
            include_tags=include_tags,
            exclude_tags=exclude_tags,
            skip_tls_verification=skip_tls_verification,
            wait_for=wait_for,
            remove_base64_images=remove_base64_images
        )
        # Return the markdown content from the Document object
        if "markdown" in formats:
            return scrape_result.markdown or ""
        elif "html" in formats:
            return scrape_result.html or ""
        else:
            return scrape_result.markdown or scrape_result.html or ""

    @global_exception_handler(1205, "Error in Scraping Multiple URLs")
    def scrape_multiple(
        self,
        urls: List[str],
        formats: List[str] = ["markdown", "html"],
        is_only_main_content: bool = True,
        include_tags: List[str] = [],
        exclude_tags: List[str] = [],
        skip_tls_verification: bool = True,
        wait_for: int = 120,
        remove_base64_images: bool = True
    ) -> List[str]:
        """
        Scrapes the content of multiple URLs and returns the content in the specified formats
        
        Args:
            urls (List[str]): The URLs to scrape
            formats (List[str], optional): The formats in which the content should be returned. Defaults to ["markdown", "html"].
            is_only_main_content (bool, optional): Whether only the main content should be scraped. Defaults
            include_tags (List[str], optional): The tags to include in the scraped content. Defaults to [].
            exclude_tags (List[str], optional): The tags to exclude from the scraped content. Defaults to [].
            skip_tls_verification (bool, optional): Whether to skip TLS verification. Defaults to True.
            wait_for (int, optional): The time to wait for the page to load. Defaults to 120.
            remove_base64_images (bool, optional): Whether to remove base64 images. Defaults to True.
 
        Returns:
            List[str]: The scraped content in the specified formats
        """

        results = []
        with concurrent.futures.ThreadPoolExecutor() as executor:
            future_to_url = {
                executor.submit(
                    self.url_scrape,
                    url,
                    formats,
                    is_only_main_content,
                    include_tags,
                    exclude_tags,
                    skip_tls_verification,
                    wait_for,
                    remove_base64_images
                ): url for url in urls
            }
            for future in concurrent.futures.as_completed(future_to_url):
                result = future.result()
                results.append(result)
        return results

    @global_exception_handler(1206, "Error in Crawling URL")
    def url_crawl(
        self,
        url: str,
        limit: int = 1,
        exclude_paths: List[str] = [],
        include_paths: List[str] = [],
        max_pepth: int = 10,
        ignore_sitemap: bool = True,
        allow_backward_links: bool = False,
        allow_external_links: bool = False,
        formats: List[str] = ["markdown", "html"],
        is_only_main_content: bool = True,
        include_tags: List[str] = [],
        exclude_tags: List[str] = []
    ) -> str:
        """
        Crawls the URL and returns the content in the specified formats
        
        Args:
            url (str): The URL to crawl
            limit (int, optional): The number of pages to crawl. Defaults to 1.
            exclude_paths (List[str], optional): The paths to exclude from crawling. Defaults to [].
            include_paths (List[str], optional): The paths to include in crawling. Defaults to [].
            max_pepth (int, optional): The maximum depth to crawl. Defaults to 10.
            ignore_sitemap (bool, optional): Whether to ignore the sitemap. Defaults to True.
            allow_backward_links (bool, optional): Whether to allow backward links. Defaults to False.
            allow_external_links (bool, optional): Whether to allow external links. Defaults to False.
            formats (List[str], optional): The formats in which the content should be returned. Defaults to ["markdown", "html"].
            is_only_main_content (bool, optional): Whether only the main content should be scraped. Defaults to True.
            include_tags (List[str], optional): The tags to include in the scraped content. Defaults to [].
            exclude_tags (List[str], optional): The tags to exclude from the scraped content. Defaults to [].
            
        Returns:
            str: The crawled content in the specified formats
        """

        from firecrawl.v2.types import ScrapeOptions
        
        # Create scrape options
        scrape_options = ScrapeOptions(
            formats=formats,
            only_main_content=is_only_main_content,
            include_tags=include_tags,
            exclude_tags=exclude_tags,
            wait_for=120,
            remove_base64_images=True
        )
        
        crawl_result = self.api_client.crawl(
            url,
            limit=limit,
            exclude_paths=exclude_paths,
            include_paths=include_paths,
            max_discovery_depth=max_pepth,
            ignore_sitemap=ignore_sitemap,
            allow_external_links=allow_external_links,
            scrape_options=scrape_options
        )
        
        # Return the crawl result - this will be a CrawlJob object
        return crawl_result


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv("PuppyEngine/.env", override=True)

    scraper = WebScraper()

    # URL Map
    map_result = scraper.url_map(url="https://docs.firecrawl.dev")
    print("URL Map Result:\n", map_result)

    # URL Scrape
    scrape_result = scraper.url_scrape(url="https://docs.firecrawl.dev/api-reference/endpoint/scrape")
    print("URL Scrape Result:\n", scrape_result)

    # URL Crawl
    crawl_result = scraper.url_crawl(url="https://docs.firecrawl.dev/api-reference/endpoint/scrape")
    print("URL Crawl Result:\n", crawl_result)

