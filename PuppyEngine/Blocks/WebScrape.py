import os
import concurrent.futures
from typing import List, Optional
from firecrawl import FirecrawlApp
from Utils.PuppyEngineExceptions import PuppyEngineException, global_exception_handler


class WebScraper:
    def __init__(
        self,
        api_key: Optional[str] = None
    ):
        self.api_client = FirecrawlApp(api_key or os.getenv("FIRECRAWL_API_KEY"))
        if not api_key:
            raise PuppyEngineException(1302, "Invalid or Missing FireCrawl API Key", f"FIRECRAWL_API_KEY: {api_key}")

    @global_exception_handler(1301, "Error in getting URL Mapping")
    def url_map(
        self,
        url: str
    ) -> List[str]:
        """
        Maps the URL to all the other URLs that are linked to it
        
        Args:
            url (str): The URL to map
        """

        return self.api_client.map_url(url)

    @global_exception_handler(1302, "Error in Scraping URL")
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

        scrape_result = self.api_client.scrape_url(
            url,
            params={
                "formats": formats,
                "onlyMainContent": is_only_main_content,
                "includeTags": include_tags,
                "excludeTags": exclude_tags,
                "skipTlsVerification": skip_tls_verification,
                "waitFor": wait_for,
                "removeBase64Images": remove_base64_images
            }
        )
        return scrape_result

    @global_exception_handler(1303, "Error in Scraping Multiple URLs")
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

    @global_exception_handler(1304, "Error in Crawling URL")
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

        crawl_result = self.api_client.crawl_url(
            url,
            params={
                "limit": limit,
                "excludePaths": exclude_paths,
                "includePaths": include_paths,
                "maxDepth": max_pepth,
                "ignoreSitemap": ignore_sitemap,
                "allowBackwardLinks": allow_backward_links,
                "allowExternalLinks": allow_external_links,
                "scrapeOptions": {
                    "formats": formats,
                    "onlyMainContent": is_only_main_content,
                    "includeTags": include_tags,
                    "excludeTags": exclude_tags,
                    "waitFor": 120,
                    "removeBase64Images": True
                }
            }
        )
        return crawl_result


if __name__ == "__main__":
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
