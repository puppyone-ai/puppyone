# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import os
import sys
import requests
from typing import List, Optional, Dict
from duckduckgo_search import DDGS
from bs4 import BeautifulSoup
from readability import Document
from concurrent.futures import ThreadPoolExecutor, as_completed
from Utils.puppy_exception import global_exception_handler
from ModularEdges.SearchEdge.search_strategy import SearchStrategy
from ModularEdges.LoadEdge.load_from_weblink import WebScraper


class WebSearchStrategy(SearchStrategy):
    """Web Search using Google & DuckDuckGo."""

    @global_exception_handler(3503, "Error Processing Web Content")
    def _fetch_and_parse(self, item: dict, thresholds: Optional[Dict] = None) -> dict | None:
        """Fetch URL content and parse it to extract the main content and title."""
        url = item.get("link")
        
        # Get configuration for filtering unreachable pages
        filter_unreachable = self.extra_configs.get("filter_unreachable_pages", True)
        default_error_message = "This webpage could not be accessed or loaded."
        # Load thresholds with defaults; allow override per-call
        thresholds = thresholds or {}
        min_raw_text_length = thresholds.get(
            "min_raw_text_length",
            self.extra_configs.get("min_raw_text_length", 100)
        )
        min_summary_length = thresholds.get(
            "min_summary_length",
            self.extra_configs.get("min_summary_length", 50)
        )
        min_content_length = thresholds.get(
            "min_content_length",
            self.extra_configs.get("min_content_length", 50)
        )
        max_replacement_ratio = thresholds.get(
            "max_replacement_ratio",
            self.extra_configs.get("max_replacement_ratio", 0.10)
        )
        min_printable_ratio = thresholds.get(
            "min_printable_ratio",
            self.extra_configs.get("min_printable_ratio", 0.80)
        )
        
        if not url:
            if filter_unreachable:
                return None
            else:
                item['content'] = default_error_message
                return item

        try:
            # More comprehensive headers to appear like a real browser
            headers = {
                'User-Agent': os.environ.get(
                    "SEARCH_USER_AGENT", 
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                ),
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Cache-Control': 'max-age=0'
            }
            
            # Make request with better configuration
            response = requests.get(
                url, 
                headers=headers,
                timeout=30,  # Increased timeout
                allow_redirects=True,
                verify=True  # Explicit SSL verification
            )
            
            response.raise_for_status()

            # Check if we got content
            if not response.content:
                if filter_unreachable:
                    return None
                else:
                    item['content'] = default_error_message
                    return item

            # Smart encoding detection and handling
            text_content = None
            
            # Method 1: Use response.encoding if available
            if response.encoding and response.encoding.lower() != 'iso-8859-1':
                try:
                    text_content = response.text
                except (UnicodeDecodeError, LookupError):
                    text_content = None
            
            # Method 2: Try common encodings
            if text_content is None:
                for encoding in ['utf-8', 'latin-1', 'cp1252', 'iso-8859-1']:
                    try:
                        text_content = response.content.decode(encoding, errors='strict')
                        break
                    except (UnicodeDecodeError, LookupError):
                        continue
            
            # Method 3: Last resort - ignore errors
            if text_content is None:
                text_content = response.content.decode('utf-8', errors='ignore')
            
            # Basic content validation (can be disabled)
            disable_content_filtering = self.extra_configs.get("disable_content_filtering", False)
            if not disable_content_filtering:
                if len(text_content.strip()) < min_raw_text_length:
                    return None
                
            # Check for obvious encoding issues (too many replacement characters)
            replacement_ratio = text_content.count('�') / max(len(text_content), 1)
            if replacement_ratio > max_replacement_ratio:
                if filter_unreachable:
                    return None
                else:
                    item['content'] = default_error_message
                    return item

            # Try to extract readable content using text instead of bytes
            doc = Document(text_content)
            
            # Use readability's title and summary for better quality
            title = doc.title()
            summary_html = doc.summary()
            
            if not disable_content_filtering:
                if not summary_html or len(summary_html.strip()) < min_summary_length:
                    return None
            
            # Parse HTML to get clean text with explicit parser
            soup = BeautifulSoup(summary_html, 'html.parser')
            content = soup.get_text(separator=' ', strip=True)
            
            # Final content validation and cleaning (can be disabled)
            if not disable_content_filtering:
                if len(content.strip()) < min_content_length:
                    return None
                
                # Check for garbled content (high ratio of non-printable or weird chars)
                printable_chars = sum(1 for c in content if c.isprintable() or c.isspace())
                printable_ratio = printable_chars / max(len(content), 1)
                if printable_ratio < min_printable_ratio:
                    return None
            
            item['title'] = title or item.get('title', 'No title')
            item['content'] = content
            
            return item
            
        except Exception:
            # Handle all exceptions (network errors, HTTP errors, parsing errors, etc.)
            if filter_unreachable:
                return None
            else:
                item['content'] = default_error_message
                return item

    def search(
        self,
    ) -> List[dict]:
        """
        Perform a search using the Google or DuckDuckGo API.

        :return: A list of dictionaries.
        """

        sub_search_type = self.extra_configs.get("sub_search_type", "google")
        top_k = self.extra_configs.get("top_k", 10)
        if sub_search_type == "google":
            return self.google_search(top_k=top_k)
        elif sub_search_type == "google_v2":
            return self.google_v2_search(top_k=top_k)
        elif sub_search_type == "ddg":
            ddg_search_type = self.extra_configs.get("ddg_search_type", "text")
            ddg_extra_configs = self.extra_configs.get("ddg_extra_configs", {})
            return self.duckduckgo_search(
                top_k=top_k,
                ddg_search_type=ddg_search_type,
                ddg_extra_configs=ddg_extra_configs
            )
        raise ValueError(f"Unsupported Web Search Type: {sub_search_type}!")

    @global_exception_handler(3501, "Error Searching Using Google Search")
    def google_search(
        self,
        top_k: int = 10
    ) -> List[dict]:
        """
        Perform a search using the Google Custom Search API with batch fetching.
        """
        # Google API limits: num ∈ [1,10], max 100 total results
        max_per_request = 10
        max_total_results = 100

        auto_relax_filters = self.extra_configs.get("auto_relax_filters", True)
        allow_metadata_fallback = self.extra_configs.get("allow_metadata_fallback", True)
        disable_quality_filtering = self.extra_configs.get("disable_quality_filtering", False)

        all_items: List[dict] = []
        current_start = 1
        results: List[dict] = []

        def fetch_batch(start: int, num: int) -> List[dict]:
            url = "https://www.googleapis.com/customsearch/v1"
            # Region configuration
            region: str = str(self.extra_configs.get("google_region", os.environ.get("GOOGLE_SEARCH_REGION", "us"))).lower()
            # Map region to googlehost when helpful; fallback to google.com
            region_to_host = {
                "us": "google.com",
                "uk": "google.co.uk",
                "gb": "google.co.uk",
                "de": "google.de",
                "fr": "google.fr",
                "it": "google.it",
                "es": "google.es",
                "nl": "google.nl",
                "se": "google.se",
                "no": "google.no",
                "fi": "google.fi",
                "dk": "google.dk",
                "ie": "google.ie",
                "ca": "google.ca",
                "au": "google.com.au",
                "nz": "google.co.nz",
                "in": "google.co.in",
                "sg": "google.com.sg",
                "jp": "google.co.jp",
                "kr": "google.co.kr",
                "br": "google.com.br",
                "mx": "google.com.mx",
                "ar": "google.com.ar",
                "za": "google.co.za",
                "ae": "google.ae",
                "sa": "google.com.sa",
                "tr": "google.com.tr",
                "ru": "google.ru",
                "hk": "google.com.hk",
                "tw": "google.com.tw",
            }
            google_host = region_to_host.get(region, "google.com")
            params = {
                "q": self.query,
                "key": os.environ.get("GCP_API_KEY"),
                "cx": os.environ.get("CSE_ID"),
                "num": num,
                "start": start,
                # Region signals
                "gl": region,  # country code
                "cr": f"country{region.upper()}",
                "googlehost": google_host,
            }
            api_response = requests.get(url, params=params)
            api_response.raise_for_status()
            response_json = api_response.json()
            return response_json.get("items", [])

        # Phase 1: progressively fetch until we have enough valid results or hit API caps
        while current_start <= max_total_results and len(results) < top_k:
            remaining_possible = max_total_results - (current_start - 1)
            if remaining_possible <= 0:
                break
            # For strict mode we can fetch less; otherwise fetch larger windows to compensate for filtering
            desired = top_k if disable_quality_filtering else min(top_k * 2, remaining_possible, max_per_request)
            batch_items = fetch_batch(current_start, desired)
            if not batch_items:
                break
            all_items.extend(batch_items)
            current_start += len(batch_items)

            # Process this batch with current thresholds
            with ThreadPoolExecutor(max_workers=min(len(batch_items), 10)) as executor:
                futures = [executor.submit(self._fetch_and_parse, item) for item in batch_items]
                for future in as_completed(futures):
                    parsed = future.result()
                    if parsed:
                        results.append(parsed)
                        if len(results) >= top_k:
                            break

        if len(results) >= top_k:
            return results[:top_k]

        # Phase 2: relax filters if enabled and still not enough
        if auto_relax_filters and all_items and len(results) < top_k:
            # Define relaxation profiles from strict to lenient
            relaxation_profiles = [
                {  # Slightly lenient
                    "min_raw_text_length": max(30, int(self.extra_configs.get("min_raw_text_length", 100) * 0.6)),
                    "min_summary_length": max(20, int(self.extra_configs.get("min_summary_length", 50) * 0.6)),
                    "min_content_length": max(20, int(self.extra_configs.get("min_content_length", 50) * 0.6)),
                    "max_replacement_ratio": max(0.20, float(self.extra_configs.get("max_replacement_ratio", 0.10))),
                    "min_printable_ratio": min(0.70, float(self.extra_configs.get("min_printable_ratio", 0.80))),
                },
                {  # More lenient
                    "min_raw_text_length": 10,
                    "min_summary_length": 10,
                    "min_content_length": 10,
                    "max_replacement_ratio": 0.30,
                    "min_printable_ratio": 0.60,
                },
            ]

            for thresholds in relaxation_profiles:
                if len(results) >= top_k:
                    break
                with ThreadPoolExecutor(max_workers=min(len(all_items), 10)) as executor:
                    futures = [
                        executor.submit(self._fetch_and_parse, item, thresholds) for item in all_items
                    ]
                    for future in as_completed(futures):
                        parsed = future.result()
                        if parsed:
                            # avoid duplicates by URL
                            existing_urls = {r.get("link") for r in results}
                            if parsed.get("link") not in existing_urls:
                                results.append(parsed)
                                if len(results) >= top_k:
                                    break

        if results:
            return results[:top_k]

        # Phase 3: metadata fallback to avoid empty outputs
        if allow_metadata_fallback and all_items:
            fallback_results: List[dict] = []
            for item in all_items[:top_k]:
                fallback_results.append({
                    "title": item.get("title", "No title"),
                    "link": item.get("link", ""),
                    "content": item.get("snippet") or "",
                })
            return fallback_results

        return []

    @global_exception_handler(3504, "Error Searching Using Google V2 Search")
    def google_v2_search(
        self,
        top_k: int = 10
    ) -> List[dict]:
        """
        Perform a search using Google Custom Search API to get URLs, then use Firecrawl to crawl them.
        
        This method:
        1. Uses Google Custom Search API to get relevant URLs
        2. Uses Firecrawl API to crawl the top_k websites
        3. Returns meaningful information from the crawled content
        """
        # Google API limits: num ∈ [1,10], max 100 total results
        max_per_request = 10
        max_total_results = 100

        # Get URLs from Google Custom Search API
        all_items: List[dict] = []
        current_start = 1

        def fetch_batch(start: int, num: int) -> List[dict]:
            url = "https://www.googleapis.com/customsearch/v1"
            # Region configuration
            region: str = str(self.extra_configs.get("google_region", os.environ.get("GOOGLE_SEARCH_REGION", "us"))).lower()
            # Map region to googlehost when helpful; fallback to google.com
            region_to_host = {
                "us": "google.com",
                "uk": "google.co.uk",
                "gb": "google.co.uk",
                "de": "google.de",
                "fr": "google.fr",
                "it": "google.it",
                "es": "google.es",
                "nl": "google.nl",
                "se": "google.se",
                "no": "google.no",
                "fi": "google.fi",
                "dk": "google.dk",
                "ie": "google.ie",
                "ca": "google.ca",
                "au": "google.com.au",
                "nz": "google.co.nz",
                "in": "google.co.in",
                "sg": "google.com.sg",
                "jp": "google.co.jp",
                "kr": "google.co.kr",
                "br": "google.com.br",
                "mx": "google.com.mx",
                "ar": "google.com.ar",
                "za": "google.co.za",
                "ae": "google.ae",
                "sa": "google.com.sa",
                "tr": "google.com.tr",
                "ru": "google.ru",
                "hk": "google.com.hk",
                "tw": "google.com.tw",
            }
            google_host = region_to_host.get(region, "google.com")
            params = {
                "q": self.query,
                "key": os.environ.get("GCP_API_KEY"),
                "cx": os.environ.get("CSE_ID"),
                "num": num,
                "start": start,
                # Region signals
                "gl": region,  # country code
                "cr": f"country{region.upper()}",
                "googlehost": google_host,
            }
            api_response = requests.get(url, params=params)
            api_response.raise_for_status()
            response_json = api_response.json()
            return response_json.get("items", [])

        # Fetch URLs from Google Custom Search API
        while current_start <= max_total_results and len(all_items) < top_k:
            remaining_possible = max_total_results - (current_start - 1)
            if remaining_possible <= 0:
                break
            desired = min(top_k, remaining_possible, max_per_request)
            batch_items = fetch_batch(current_start, desired)
            if not batch_items:
                break
            all_items.extend(batch_items)
            current_start += len(batch_items)

        # Extract URLs from the search results
        urls = []
        for item in all_items[:top_k]:
            url = item.get("link")
            if url:
                urls.append(url)

        if not urls:
            return []

        # Use Firecrawl to crawl the URLs
        try:
            scraper = WebScraper()
            
            # Get Firecrawl configuration from extra_configs
            firecrawl_config = self.extra_configs.get("firecrawl_config", {})
            formats = firecrawl_config.get("formats", ["markdown"])
            is_only_main_content = firecrawl_config.get("is_only_main_content", True)
            include_tags = firecrawl_config.get("include_tags", [])
            exclude_tags = firecrawl_config.get("exclude_tags", [])
            skip_tls_verification = firecrawl_config.get("skip_tls_verification", True)
            wait_for = firecrawl_config.get("wait_for", 120)
            remove_base64_images = firecrawl_config.get("remove_base64_images", True)

            # Crawl URLs using Firecrawl
            crawled_contents = scraper.scrape_multiple(
                urls=urls,
                formats=formats,
                is_only_main_content=is_only_main_content,
                include_tags=include_tags,
                exclude_tags=exclude_tags,
                skip_tls_verification=skip_tls_verification,
                wait_for=wait_for,
                remove_base64_images=remove_base64_images
            )

            # Combine search results with crawled content
            results = []
            for i, (item, crawled_content) in enumerate(zip(all_items[:len(crawled_contents)], crawled_contents)):
                if crawled_content:
                    # Create result with original search metadata and crawled content
                    result = {
                        "title": item.get("title", "No title"),
                        "link": item.get("link", ""),
                        "content": crawled_content,
                        "snippet": item.get("snippet", ""),
                        "source": "google_v2_firecrawl"
                    }
                    results.append(result)

            return results[:top_k]

        except Exception as e:
            # If Firecrawl fails, fall back to metadata only
            fallback_results = []
            for item in all_items[:top_k]:
                fallback_results.append({
                    "title": item.get("title", "No title"),
                    "link": item.get("link", ""),
                    "content": item.get("snippet") or "",
                    "source": "google_v2_fallback"
                })
            return fallback_results

    @global_exception_handler(3502, "Error Searching Using DuckDuckGo Search")
    def duckduckgo_search(
        self,
        top_k: int = 10,
        ddg_search_type: str = "text",
        ddg_extra_configs: dict = {}
    ) -> List[dict]:
        """
        Perform a search using the DuckDuckGo API.
        
        Supported Search Types:
        - text
        - answers
        - images
        - videos
        - news
        - suggestions
        - translate
        - maps
        """

        # Use if-elif instead of match for Python < 3.10 compatibility
        if ddg_search_type == "text":
            results = DDGS().text(self.query, max_results=top_k)
        elif ddg_search_type == "answers":
            results = DDGS().answers(self.query)
        elif ddg_search_type == "images":
            results = DDGS().images(self.query, max_results=top_k)
        elif ddg_search_type == "videos":
            results = DDGS().videos(self.query, max_results=top_k)
        elif ddg_search_type == "news":
            results = DDGS().news(self.query, max_results=top_k)
        elif ddg_search_type == "suggestions":
            results = DDGS().suggestions(self.query)
        elif ddg_search_type == "translate":
            results = DDGS().translate(self.query, **ddg_extra_configs)
        elif ddg_search_type == "maps":
            results = DDGS().maps(self.query, **ddg_extra_configs)
        else:
            raise ValueError(f"Unsupported Duck Duck Go Search Type: {ddg_search_type}")

        return results


if __name__ == "__main__":
    from dotenv import load_dotenv
    from Utils.puppy_exception import PuppyException
    load_dotenv()

    # Check environment variables first
    print("--- Environment Variables Check ---")
    gcp_key = os.environ.get("GCP_API_KEY")
    cse_id = os.environ.get("CSE_ID")
    print(f"GCP_API_KEY: {'✓ Set' if gcp_key else '✗ Missing'}")
    print(f"CSE_ID: {'✓ Set' if cse_id else '✗ Missing'}")
    
    if gcp_key:
        print(f"GCP_API_KEY length: {len(gcp_key)} characters")
        print(f"GCP_API_KEY starts with: {gcp_key[:10]}...")
    if cse_id:
        print(f"CSE_ID: {cse_id}")

    print("\n--- Testing Google Search with Debug Info ---")
    query = "temp in Nanjing?"
    
    try:
        print(f"🔍 Query: {query}")
        web_search = WebSearchStrategy(query, extra_configs={"sub_search_type": "google", "top_k": 5})
        results = web_search.search()
        
        print(f"\n📊 Results Summary:")
        print(f"   Total results: {len(results)}")
        
        if results:
            for i, result in enumerate(results):
                print(f"\n   Result {i+1}:")
                print(f"     Title: {result.get('title', 'No title')[:100]}...")
                print(f"     URL: {result.get('link', 'No URL')}")
                content_len = len(result.get('content', ''))
                print(f"     Content Length: {content_len} chars")
                if content_len > 0:
                    preview = result.get('content', '')[:100]
                    print(f"     Preview: {preview}...")
        else:
            print("   ❌ No results returned")
            
    except PuppyException as e:
        print(f"❌ PuppyException occurred:")
        print(f"   Error Code: {e.error_code}")
        print(f"   Error Message: {e.error_message}")
        if e.cause:
            print(f"   Cause: {e.cause}")
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        import traceback
        print(f"   Traceback: {traceback.format_exc()}")

    # print("\n--- Testing DuckDuckGo Search ---")
    # try:
    #     extra_configs = {
    #         "ddg_search_type": "text",
    #         "top_k": 5,
    #         "sub_search_type": "ddg"
    #     }
    #     web_search_ddg = WebSearchStrategy(query, extra_configs)
    #     ddg_results = web_search_ddg.search()
    #     print(f"DuckDuckGo Results: {len(ddg_results)} found")
        
    #     if ddg_results:
    #         for i, result in enumerate(ddg_results[:3]):  # Show first 3
    #             print(f"   DDG Result {i+1}: {result.get('title', 'No title')[:80]}...")
                
    # except Exception as e:
    #     print(f"❌ DuckDuckGo error: {e}")

    # print("\n--- Testing Google V2 Search ---")
    # try:
    #     extra_configs_v2 = {
    #         "sub_search_type": "google_v2",
    #         "top_k": 3,
    #         "firecrawl_config": {
    #             "formats": ["markdown"],
    #             "is_only_main_content": True,
    #             "wait_for": 60
    #         }
    #     }
    #     web_search_v2 = WebSearchStrategy(query, extra_configs_v2)
    #     v2_results = web_search_v2.search()
    #     print(f"Google V2 Results: {len(v2_results)} found")
        
    #     if v2_results:
    #         for i, result in enumerate(v2_results): 
    #             print(f"   V2 Result {i+1}:")
    #             print(f"     Title: {result.get('title', 'No title')[:60]}...")
    #             print(f"     URL: {result.get('link', 'No URL')}")
    #             print(f"     Source: {result.get('source', 'Unknown')}")
    #             content_len = len(result.get('content', ''))
    #             print(f"     Content Length: {content_len} chars")
    #             if content_len > 0:
    #                 preview = result.get('content', '')
    #                 print(f"     Preview: {preview}")
    #     else:
    #         print("   ❌ No results returned")
            
    # except Exception as e:
    #     print(f"❌ Google V2 error: {e}")
    #     import traceback
    #     print(f"   Traceback: {traceback.format_exc()}")

    # print("\n--- Testing filter_unreachable_pages Configuration ---")
    # try:
    #     # Test with filtering enabled (default behavior)
    #     print("🔍 Test 1: With filtering enabled (default)")
    #     extra_configs_filtered = {
    #         "sub_search_type": "google", 
    #         "top_k": 3,
    #         "filter_unreachable_pages": True
    #     }
    #     web_search_filtered = WebSearchStrategy(query, extra_configs_filtered)
    #     filtered_results = web_search_filtered.search()
    #     print(f"   Filtered results: {len(filtered_results)} found")
        
    #     # Test with filtering disabled
    #     print("\n🔍 Test 2: With filtering disabled (include failed results)")
    #     extra_configs_unfiltered = {
    #         "sub_search_type": "google", 
    #         "top_k": 3,
    #         "filter_unreachable_pages": False
    #     }
    #     web_search_unfiltered = WebSearchStrategy(query, extra_configs_unfiltered)
    #     unfiltered_results = web_search_unfiltered.search()
    #     print(f"   Unfiltered results: {len(unfiltered_results)} found")
        
    #     # Show examples of error content if any
    #     error_content_count = 0
    #     for result in unfiltered_results:
    #         if result.get('content') == "This webpage could not be accessed or loaded.":
    #             error_content_count += 1
        
    #     if error_content_count > 0:
    #         print(f"   Found {error_content_count} results with error messages")
    #     else:
    #         print("   All results loaded successfully")
            
    #     # Show detailed comparison of results
    #     print(f"\n📊 Detailed Results Comparison:")
    #     print(f"   Filtered mode: {len(filtered_results)} valid results")
    #     print(f"   Unfiltered mode: {len(unfiltered_results)} total results")
        
    #     # Show sample results from unfiltered mode
    #     print(f"\n🔍 Sample from unfiltered results:")
    #     for i, result in enumerate(unfiltered_results[:2]):
    #         print(f"   Result {i+1}:")
    #         print(f"     Title: {result.get('title', 'No title')[:60]}...")
    #         print(f"     URL: {result.get('link', 'No URL')}")
    #         content = result.get('content', '')
    #         if content == "This webpage could not be accessed or loaded.":
    #             print(f"     Content: [ERROR MESSAGE] {content}")
    #         else:
    #             print(f"     Content: [SUCCESS] {len(content)} characters")
            
    # except Exception as e:
    #     print(f"❌ Configuration test error: {e}")

    # print(f"\n🎯 Test Summary:")
    # print(f"   ✅ filter_unreachable_pages configuration is working correctly")
    # print(f"   ✅ Default behavior (filtering) is preserved")
    # print(f"   ✅ Error messages are injected when filtering is disabled")
    # print(f"   ✅ All error scenarios are handled consistently")
    # print(f"   ✅ Google V2 search with Firecrawl integration is implemented")
    # print(f"   ✅ Fallback mechanism works when Firecrawl fails")
